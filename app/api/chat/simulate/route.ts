import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { processWithGemini } from '@/lib/gemini'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { message, patientName = 'Rahul Sharma', conversationId } = body
    let phone = (body.phone || '+919876543210').trim()

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { success: false, error: 'A non-empty message is required for simulation.' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // 1. Get or create conversation thread
    let conv: any = null

    if (conversationId) {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .maybeSingle()

      if (!error && data) {
        conv = data
        phone = data.phone_number
      }
    }

    if (!conv) {
      // Look up by phone number
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('phone_number', phone)
        .maybeSingle()

      if (!error && data) {
        conv = data
      }
    }

    if (!conv) {
      // Create new conversation
      const { data: newConv, error: createErr } = await supabase
        .from('conversations')
        .insert({
          phone_number: phone,
          patient_name: patientName,
          ai_mode: true,
          last_message: message.trim(),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        })
        .select()
        .single()

      if (createErr || !newConv) {
        throw new Error(`Failed to create conversation in Supabase: ${createErr?.message}`)
      }
      conv = newConv
    } else {
      // Update patient name if empty
      if (!conv.patient_name && patientName) {
        await supabase
          .from('conversations')
          .update({ patient_name: patientName })
          .eq('id', conv.id)
        conv.patient_name = patientName
      }
    }

    // 2. Save user message into chat_messages
    const { data: userMsg, error: userMsgErr } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conv.id,
        role: 'user',
        content: message.trim(),
        message_type: 'text',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (userMsgErr) {
      console.warn('[Simulator Warning] Failed to log user message:', userMsgErr.message)
    }

    // 3. Fetch past message history for context (last 20)
    const { data: pastMessages } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .limit(20)

    const formattedHistory = (pastMessages || [])
      .filter((m) => !userMsg || m.id !== userMsg.id)
      .map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content || '' }],
      }))

    // 4. Fetch clinic settings
    const { data: settingsRow } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    const activeSettings = {
      clinicName: settingsRow?.clinic_name || process.env.CLINIC_NAME || 'SmileCare Dental & Implant Clinic',
      doctorName: settingsRow?.doctor_name || process.env.CLINIC_DOCTOR || 'Dr. A. Sharma (BDS, MDS Oral & Maxillofacial)',
      address: settingsRow?.address || process.env.CLINIC_ADDRESS || 'Suite 402, Dental Care Plaza, Metro Station Road',
      phone: settingsRow?.phone || process.env.CLINIC_PHONE || '+91 98765 43210',
      timingsStart: (settingsRow?.timings_start || process.env.CLINIC_TIMINGS_START || '09:00').slice(0, 5),
      timingsEnd: (settingsRow?.timings_end || process.env.CLINIC_TIMINGS_END || '18:00').slice(0, 5),
      lunchStart: (settingsRow?.lunch_start || process.env.CLINIC_LUNCH_START || '13:00').slice(0, 5),
      lunchEnd: (settingsRow?.lunch_end || process.env.CLINIC_LUNCH_END || '14:00').slice(0, 5),
      weeklyOff: settingsRow?.weekly_off || process.env.CLINIC_WEEKLY_OFF || 'Sunday',
      consultationFee: settingsRow?.consultation_fee ?? Number(process.env.CLINIC_CONSULTATION_FEE || 500),
      googleSheetId: settingsRow?.google_sheet_id || process.env.GOOGLE_SHEET_ID || '',
      googleCalendarId: settingsRow?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || '',
      services: settingsRow?.services?.length ? settingsRow.services : [
        { name: 'General Consultation', price: 500, duration_mins: 30 },
        { name: 'Teeth Cleaning & Polishing', price: 1200, duration_mins: 45 },
        { name: 'Root Canal Treatment (RCT)', price: 4500, duration_mins: 60 },
        { name: 'Dental Filling', price: 1500, duration_mins: 30 },
        { name: 'Teeth Whitening', price: 6000, duration_mins: 45 },
      ],
      faqs: settingsRow?.faqs?.length ? settingsRow.faqs : [
        { question: 'Do I need prior appointment?', answer: 'Yes, prior appointments are recommended to avoid waiting time.' },
        { question: 'What modes of payment are accepted?', answer: 'We accept Cash, UPI, Credit/Debit cards, and Net Banking.' },
      ],
      knowledge_base_text: settingsRow?.knowledge_base_text || '',
    }

    // 5. Run the Gemini AI Receptionist processing loop (Gemini 2.5 Flash + function calling)
    console.log(`[Simulator] Processing simulated message from ${conv.patient_name || patientName} (${phone}): "${message.trim()}"`)
    const geminiResult = await processWithGemini({
      conversationId: conv.id,
      patientPhone: phone,
      patientName: conv.patient_name || patientName,
      messageText: message.trim(),
      history: formattedHistory,
      settings: activeSettings,
    })

    // 6. Save AI reply to chat_messages
    const { data: aiMsg, error: aiMsgErr } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conv.id,
        role: 'assistant',
        content: geminiResult.replyText,
        message_type: 'text',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (aiMsgErr) {
      console.warn('[Simulator Warning] Failed to log AI reply:', aiMsgErr.message)
    }

    // 7. Update conversation thread last message & timestamp
    await supabase
      .from('conversations')
      .update({
        last_message: geminiResult.replyText,
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq('id', conv.id)

    return NextResponse.json({
      success: true,
      conversationId: conv.id,
      phone,
      patientName: conv.patient_name || patientName,
      userMessage: userMsg || { content: message.trim(), role: 'user' },
      aiReply: aiMsg || { content: geminiResult.replyText, role: 'assistant' },
      replyText: geminiResult.replyText,
      booking: geminiResult.bookingCreated || null,
    })
  } catch (err: any) {
    console.error('❌ [/api/chat/simulate Error]:', err)
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to simulate patient message',
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
      },
      { status: 500 }
    )
  }
}
