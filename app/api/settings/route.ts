import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // 1. Fetch from database
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    // Default settings loaded from env vars or standard defaults
    const defaultSettings = {
      clinicName: process.env.CLINIC_NAME || 'Dental Care Clinic',
      doctorName: process.env.CLINIC_DOCTOR || 'Dr. Sharma',
      address: process.env.CLINIC_ADDRESS || '123 Medical Enclave',
      phone: process.env.CLINIC_PHONE || '+91 98765 43210',
      timingsStart: process.env.CLINIC_TIMINGS_START || '09:00',
      timingsEnd: process.env.CLINIC_TIMINGS_END || '18:00',
      lunchStart: process.env.CLINIC_LUNCH_START || '13:00',
      lunchEnd: process.env.CLINIC_LUNCH_END || '14:00',
      weeklyOff: process.env.CLINIC_WEEKLY_OFF || 'Sunday',
      slotDurationMinutes: 30,
      consultationFee: Number(process.env.CLINIC_CONSULTATION_FEE || 500),
      googleSheetId: process.env.GOOGLE_SHEET_ID || '',
      googleCalendarId: process.env.GOOGLE_CALENDAR_ID || '',
      aiMode: 'ai',
      welcomeMessage: 'Hello! Welcome to our dental clinic. How can I assist you with your appointment today?',
      services: [
        { id: '1', name: 'General Consultation', price: 500, durationMinutes: 30 },
        { id: '2', name: 'Teeth Cleaning & Polishing', price: 1200, durationMinutes: 45 },
        { id: '3', name: 'Root Canal Treatment (RCT)', price: 4500, durationMinutes: 60 },
        { id: '4', name: 'Dental Filling', price: 1500, durationMinutes: 30 },
        { id: '5', name: 'Teeth Whitening', price: 6000, durationMinutes: 45 },
      ],
      faqs: [
        { id: '1', question: 'Do I need prior appointment?', answer: 'Yes, prior appointments are recommended to avoid waiting time.' },
        { id: '2', question: 'What modes of payment are accepted?', answer: 'We accept Cash, UPI, Credit/Debit cards, and Net Banking.' },
      ],
      knowledgeBaseText: '',
    }

    if (error || !data) {
      return NextResponse.json({ success: true, settings: defaultSettings })
    }

    // Map database snake_case columns to camelCase object
    const merged = {
      id: data.id,
      clinicName: data.clinic_name || defaultSettings.clinicName,
      doctorName: data.doctor_name || defaultSettings.doctorName,
      address: data.address || defaultSettings.address,
      phone: data.phone || defaultSettings.phone,
      timingsStart: (data.timings_start || defaultSettings.timingsStart).slice(0, 5),
      timingsEnd: (data.timings_end || defaultSettings.timingsEnd).slice(0, 5),
      lunchStart: (data.lunch_start || defaultSettings.lunchStart).slice(0, 5),
      lunchEnd: (data.lunch_end || defaultSettings.lunchEnd).slice(0, 5),
      weeklyOff: data.weekly_off || defaultSettings.weeklyOff,
      slotDurationMinutes: 30,
      consultationFee: data.consultation_fee ?? defaultSettings.consultationFee,
      googleSheetId: data.google_sheet_id || defaultSettings.googleSheetId,
      googleCalendarId: data.google_calendar_id || defaultSettings.googleCalendarId,
      aiMode: 'ai',
      welcomeMessage: defaultSettings.welcomeMessage,
      services: data.services?.length ? data.services : defaultSettings.services,
      faqs: data.faqs?.length ? data.faqs : defaultSettings.faqs,
      knowledgeBaseText: data.knowledge_base_text || defaultSettings.knowledgeBaseText,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }

    return NextResponse.json({ success: true, settings: merged })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createAdminClient()

    console.log('[POST /api/settings] Received update request:', {
      clinicName: body.clinicName || body.clinic_name,
      googleSheetId: body.googleSheetId || body.google_sheet_id,
      googleCalendarId: body.googleCalendarId || body.google_calendar_id,
    })

    // Map camelCase to snake_case for Supabase
    const payload: any = {
      clinic_name: body.clinicName || body.clinic_name,
      doctor_name: body.doctorName || body.doctor_name,
      address: body.address,
      phone: body.phone,
      timings_start: body.timingsStart || body.timings_start,
      timings_end: body.timingsEnd || body.timings_end,
      lunch_start: body.lunchStart || body.lunch_start,
      lunch_end: body.lunchEnd || body.lunch_end,
      weekly_off: body.weeklyOff || body.weekly_off,
      consultation_fee: Number(body.consultationFee ?? body.consultation_fee ?? 0),
      services: body.services || [],
      faqs: body.faqs || [],
      google_sheet_id: body.googleSheetId || body.google_sheet_id,
      google_calendar_id: body.googleCalendarId || body.google_calendar_id,
      knowledge_base_text: body.knowledgeBaseText || body.knowledge_base_text || '',
      updated_at: new Date().toISOString(),
    }

    // Check if a row exists
    const { data: existing, error: findErr } = await supabase
      .from('clinic_settings')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (findErr) {
      console.warn('[POST /api/settings] Warning finding clinic_settings row:', findErr.message)
    }

    let result
    if (existing?.id) {
      result = await supabase
        .from('clinic_settings')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single()
    } else {
      result = await supabase
        .from('clinic_settings')
        .insert([payload])
        .select()
        .single()
    }

    if (result.error) {
      console.error('❌ [POST /api/settings DB Error]:', result.error.message, result.error)
      throw result.error
    }

    console.log('✅ [POST /api/settings] Saved successfully to Supabase:', result.data?.id)
    return NextResponse.json({ success: true, data: result.data })
  } catch (err: any) {
    console.error('❌ [POST /api/settings Error]:', err?.message || err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  return POST(request)
}
