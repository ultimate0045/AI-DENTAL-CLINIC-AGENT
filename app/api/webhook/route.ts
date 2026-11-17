import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { processWithGemini } from '@/lib/gemini'
import { sendTextMessage, markMessageAsRead } from '@/lib/metaWhatsapp'

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
    const formattedPhone = fromPhone ? (fromPhone.startsWith('+') ? fromPhone : `+${fromPhone}`) : ''
    const messageType = rawMessage.type
    const contactName = value.contacts?.[0]?.profile?.name || ''

    if (!messageId || !formattedPhone) {
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

    // Layer 2: Persistent Supabase table
    const supabase = createAdminClient()
    const { data: existing } = await supabase
      .from('processed_messages')
      .select('message_id')
      .eq('message_id', messageId)
      .maybeSingle()

    if (existing) {
      console.log(`[Meta Webhook] Persistent DB duplicate message skipped: ${messageId}`)
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }

    await supabase.from('processed_messages').insert({
      message_id: messageId,
      processed_at: new Date().toISOString(),
    })

    // 2. Mark as read on WhatsApp
    await markMessageAsRead(messageId).catch(() => {})

    // 3. Find or create conversation
    let { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', formattedPhone)
      .maybeSingle()

    let textContent = ''
    if (messageType === 'text') {
      textContent = rawMessage.text?.body || ''
    } else if (messageType === 'interactive') {
      textContent = rawMessage.interactive?.button_reply?.title || rawMessage.interactive?.list_reply?.title || ''
    } else {
      textContent = `[Received ${messageType}]`
    }

    if (!conv) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          phone_number: formattedPhone,
          patient_name: contactName,
          ai_mode: true,
          last_message: textContent,
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        })
        .select()
        .single()
      conv = newConv
    } else {
      await supabase
        .from('conversations')
        .update({
          last_message: textContent,
          last_message_at: new Date().toISOString(),
          unread_count: (conv.unread_count || 0) + 1,
          ...(contactName && !conv.patient_name ? { patient_name: contactName } : {}),
        })
        .eq('id', conv.id)
    }

    if (!conv) return NextResponse.json({ status: 'ok' }, { status: 200 })

    // 4. Save inbound message into chat_messages
    await supabase.from('chat_messages').insert({
      conversation_id: conv.id,
      role: 'user',
      content: textContent,
      message_type: messageType,
      whatsapp_message_id: messageId,
      created_at: new Date().toISOString(),
    })

    // 5. If AI Mode is enabled, process with Gemini 2.5 Flash and reply via Meta WhatsApp
    if (conv.ai_mode !== false) {
      // Fetch clinic settings
      const { data: settingsRow } = await supabase.from('clinic_settings').select('*').limit(1).maybeSingle()
      const activeSettings = {
        clinicName: settingsRow?.clinic_name || process.env.CLINIC_NAME || 'SmileCare Dental & Implant Clinic',
        doctorName: settingsRow?.doctor_name || process.env.CLINIC_DOCTOR || 'Dr. A. Sharma (BDS, MDS)',
        address: settingsRow?.address || process.env.CLINIC_ADDRESS || 'Suite 402, Dental Care Plaza',
        phone: settingsRow?.phone || process.env.CLINIC_PHONE || '+91 98765 43210',
        timingsStart: (settingsRow?.timings_start || process.env.CLINIC_TIMINGS_START || '09:00').slice(0, 5),
        timingsEnd: (settingsRow?.timings_end || process.env.CLINIC_TIMINGS_END || '18:00').slice(0, 5),
        lunchStart: (settingsRow?.lunch_start || process.env.CLINIC_LUNCH_START || '13:00').slice(0, 5),
        lunchEnd: (settingsRow?.lunch_end || process.env.CLINIC_LUNCH_END || '14:00').slice(0, 5),
        weeklyOff: settingsRow?.weekly_off || process.env.CLINIC_WEEKLY_OFF || 'Sunday',
        consultationFee: settingsRow?.consultation_fee ?? Number(process.env.CLINIC_CONSULTATION_FEE || 500),
        googleSheetId: settingsRow?.google_sheet_id || process.env.GOOGLE_SHEET_ID || '',
        googleCalendarId: settingsRow?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || '',
        services: settingsRow?.services || [],
        faqs: settingsRow?.faqs || [],
        knowledge_base_text: settingsRow?.knowledge_base_text || '',
      }

      // Fetch message history for context
      const { data: pastMessages } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true })
        .limit(10)

      const formattedHistory = (pastMessages || []).slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content || '' }],
      }))

      const aiResult = await processWithGemini({
        conversationId: conv.id,
        patientPhone: formattedPhone,
        patientName: conv.patient_name || contactName,
        messageText: textContent,
        history: formattedHistory,
        settings: activeSettings,
      })

      // Send WhatsApp reply back to patient via Meta Cloud API
      await sendTextMessage(formattedPhone, aiResult.replyText)

      // Save AI reply into chat_messages
      await supabase.from('chat_messages').insert({
        conversation_id: conv.id,
        role: 'assistant',
        content: aiResult.replyText,
        message_type: 'text',
        created_at: new Date().toISOString(),
      })

      // Update conversation
      await supabase
        .from('conversations')
        .update({
          last_message: aiResult.replyText,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conv.id)
    }

    return NextResponse.json({ status: 'processed' }, { status: 200 })
  } catch (err: any) {
    console.error('❌ [POST /api/webhook Error]:', err?.message)
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
