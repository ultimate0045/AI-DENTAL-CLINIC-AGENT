import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getDynamicCredentials } from '@/lib/credentials'
import { processWithGemini } from '@/lib/gemini'
import { sendTextMessage, markMessageAsRead } from '@/lib/metaWhatsapp'
import { normalizePhone } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// ─── In-Memory Deduplication Set ─────────────────────────────────────────────
const inMemoryProcessedIds = new Set<string>()

/**
 * GET /api/webhook — Meta Webhook Verification Challenge
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Meta Webhook] Verification successful!')
    return new Response(challenge || '', { status: 200 })
  }

  console.warn('[Meta Webhook] Verification failed — token mismatch or invalid mode')
  return new Response('Forbidden', { status: 403 })
}

/**
 * POST /api/webhook — Meta Webhook Inbound Message Handler
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ status: 'ignored' }, { status: 200 })
    }

    const entry = body.entry?.[0]
    const changes = entry?.changes?.[0]

    // Guardrail: Only process 'messages' changes
    if (changes?.field && changes.field !== 'messages') {
      return NextResponse.json({ status: 'ignored_field' }, { status: 200 })
    }

    const value = changes?.value

    // Guardrail: Strictly ignore status updates (sent, delivered, read) — NEVER reply to statuses!
    if (value?.statuses && value.statuses.length > 0) {
      return NextResponse.json({ status: 'ignored_status' }, { status: 200 })
    }

    if (!value?.messages?.length) {
      return NextResponse.json({ status: 'no_messages' }, { status: 200 })
    }

    const rawMessage = value.messages[0]
    const messageId = rawMessage.id
    const fromPhone = rawMessage.from // E.164 without plus e.g. 919876543210
    const normalizedPhone = normalizePhone(fromPhone)
    const messageType = rawMessage.type
    const contactName = value.contacts?.[0]?.profile?.name || ''

    if (!messageId || !normalizedPhone) {
      return NextResponse.json({ status: 'invalid_payload' }, { status: 200 })
    }

    // ── GUARDRAIL 1: STALE MESSAGE CHECK (Max 120s old) ──────────────────────
    const rawTimestamp = parseInt(rawMessage.timestamp, 10)
    const nowSec = Math.floor(Date.now() / 1000)
    if (rawTimestamp && (nowSec - rawTimestamp > 120)) {
      console.log(`⏱️ [Next.js Webhook] Dropping stale message ${messageId} (${nowSec - rawTimestamp}s old, max 120s)`)
      return NextResponse.json({ status: 'stale_message' }, { status: 200 })
    }

    // ── GUARDRAIL 2: DUAL-LAYER MESSAGE DEDUPLICATION ────────────────────────
    // Layer 1: In-memory (fast)
    if (inMemoryProcessedIds.has(messageId)) {
      console.log(`[Meta Webhook] In-memory duplicate dropped: ${messageId}`)
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
    inMemoryProcessedIds.add(messageId)
    setTimeout(() => inMemoryProcessedIds.delete(messageId), 60 * 60 * 1000)

    let textContent = ''
    if (messageType === 'text') {
      textContent = rawMessage.text?.body || ''
    } else if (messageType === 'interactive') {
      textContent = rawMessage.interactive?.button_reply?.title || rawMessage.interactive?.list_reply?.title || ''
    } else {
      textContent = `[Received ${messageType}]`
    }

    // Layer 2: Parallelize dedup check, cached 60s credentials/KB, and conversation lookup
    const supabase = createAdminClient()
    const [existingDedupRes, dynCreds, convLookupRes] = await Promise.all([
      supabase.from('processed_messages').select('message_id').eq('message_id', messageId).maybeSingle(),
      getDynamicCredentials(),
      supabase
        .from('conversations')
        .select('*')
        .or(`phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (existingDedupRes?.data) {
      console.log(`[Meta Webhook] Persistent DB duplicate message skipped: ${messageId}`)
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }

    // Fire-and-forget processed_messages insert + mark-as-read (never blocks AI pipeline)
    Promise.resolve(
      supabase.from('processed_messages').insert({
        message_id: messageId,
        processed_at: new Date().toISOString(),
      })
    ).catch(() => {})
    markMessageAsRead(messageId).catch(() => {})

    // 3. Find or upsert single unified conversation thread per normalized phone number
    let conv = convLookupRes?.data || null
    if (!conv) {
      const { data: newConv } = await supabase
        .from('conversations')
        .upsert(
          {
            phone_number: normalizedPhone,
            patient_name: contactName || '',
            ai_mode: true,
            last_message: textContent,
            last_message_at: new Date().toISOString(),
            unread_count: 1,
          },
          { onConflict: 'phone_number' }
        )
        .select()
        .single()
      conv = newConv
    }

    if (!conv) return NextResponse.json({ status: 'ok' }, { status: 200 })

    const userMsgRecord = {
      conversation_id: conv.id,
      role: 'user',
      content: textContent,
      message_type: messageType,
      whatsapp_message_id: messageId,
      created_at: new Date().toISOString(),
    }

    // 5. If AI Mode is enabled, fetch recent 8 messages, generate reply, send WhatsApp FIRST, then save logs
    if (conv.ai_mode !== false) {
      const { data: pastMessages } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(8)

      const formattedHistory = (pastMessages || [])
        .reverse()
        .map((m) => ({
          role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
          parts: [{ text: m.content || '' }],
        }))

      const aiResult = await processWithGemini({
        conversationId: conv.id,
        patientPhone: normalizedPhone,
        patientName: conv.patient_name || contactName,
        messageText: textContent,
        history: formattedHistory,
        settings: {
          ...dynCreds,
          knowledge_base_text: dynCreds.knowledgeBaseText || '',
        },
      })

      // Send WhatsApp reply FIRST so patient gets immediate response
      await sendTextMessage(normalizedPhone, aiResult.replyText)

      // Persist both messages + update conversation concurrently after sending reply
      const assistantMsgRecord = {
        conversation_id: conv.id,
        role: 'assistant',
        content: aiResult.replyText,
        message_type: 'text',
        created_at: new Date(Date.now() + 20).toISOString(),
      }
      await Promise.allSettled([
        supabase.from('chat_messages').insert([userMsgRecord, assistantMsgRecord]),
        supabase
          .from('conversations')
          .update({
            phone_number: normalizedPhone,
            last_message: aiResult.replyText,
            last_message_at: new Date().toISOString(),
            ...(contactName && !conv.patient_name ? { patient_name: contactName } : {}),
          })
          .eq('id', conv.id),
      ])
    } else {
      // Human mode: save incoming message and update conversation
      await Promise.allSettled([
        supabase.from('chat_messages').insert(userMsgRecord),
        supabase
          .from('conversations')
          .update({
            phone_number: normalizedPhone,
            last_message: textContent,
            last_message_at: new Date().toISOString(),
            unread_count: (conv.unread_count || 0) + 1,
            ...(contactName && !conv.patient_name ? { patient_name: contactName } : {}),
          })
          .eq('id', conv.id),
      ])
    }

    return NextResponse.json({ status: 'processed' }, { status: 200 })
  } catch (err: any) {
    console.error('❌ [POST /api/webhook Error]:', err?.message)
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
