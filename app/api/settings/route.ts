import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import {
  getDynamicCredentials,
  invalidateCredentialsCache,
  maskToken,
  isMasked,
} from '@/lib/credentials'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // 1. Fetch dynamic credentials (DB -> KB -> env)
    const creds = await getDynamicCredentials(true)

    // 2. Fetch clinic_settings row for services, faqs, kb text
    const { data } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    const defaultServices = [
      { id: '1', name: 'General Consultation', price: 500, durationMinutes: 30 },
      { id: '2', name: 'Teeth Cleaning & Polishing', price: 1200, durationMinutes: 45 },
      { id: '3', name: 'Root Canal Treatment (RCT)', price: 4500, durationMinutes: 60 },
      { id: '4', name: 'Dental Filling', price: 1500, durationMinutes: 30 },
      { id: '5', name: 'Teeth Whitening', price: 6000, durationMinutes: 45 },
    ]

    const defaultFaqs = [
      { id: '1', question: 'Do I need prior appointment?', answer: 'Yes, prior appointments are recommended to avoid waiting time.' },
      { id: '2', question: 'What modes of payment are accepted?', answer: 'We accept Cash, UPI, Credit/Debit cards, and Net Banking.' },
    ]

    const merged = {
      id: data?.id,
      clinicName: data?.clinic_name || creds.clinicName,
      doctorName: data?.doctor_name || creds.doctorName,
      address: data?.address || creds.clinicAddress,
      phone: data?.phone || creds.clinicPhone,
      timingsStart: creds.timingsStart,
      timingsEnd: creds.timingsEnd,
      lunchStart: creds.lunchStart,
      lunchEnd: creds.lunchEnd,
      weeklyOff: creds.weeklyOff,
      slotDurationMinutes: 30,
      consultationFee: creds.consultationFee,
      services: data?.services?.length ? data.services : defaultServices,
      faqs: data?.faqs?.length ? data.faqs : defaultFaqs,
      knowledgeBaseText: data?.knowledge_base_text || '',

      // Integrations (Masked where secret)
      metaAccessToken: maskToken(creds.metaAccessToken),
      metaPhoneNumberId: creds.metaPhoneNumberId,
      metaVerifyToken: maskToken(creds.metaVerifyToken),
      googleCalendarId: creds.googleCalendarId,
      googleSheetId: creds.googleSheetId,
      googleServiceAccountJson: creds.googleServiceAccountJson ? '••••••••' : '',
      geminiApiKey: maskToken(creds.geminiApiKey),

      // Security & presence flags
      hasMetaAccessToken: Boolean(creds.metaAccessToken),
      hasMetaPhoneNumberId: Boolean(creds.metaPhoneNumberId),
      hasMetaVerifyToken: Boolean(creds.metaVerifyToken),
      hasGoogleCalendarId: Boolean(creds.googleCalendarId),
      hasGoogleSheetId: Boolean(creds.googleSheetId),
      hasGoogleServiceAccountJson: Boolean(creds.googleServiceAccountJson),
      hasGeminiApiKey: Boolean(creds.geminiApiKey),
      hasMetaToken: Boolean(creds.metaAccessToken),
      hasMetaPhoneId: Boolean(creds.metaPhoneNumberId),
      hasGeminiKey: Boolean(creds.geminiApiKey),
      hasGoogleServiceAccount: Boolean(creds.googleServiceAccountJson),

      createdAt: data?.created_at,
      updatedAt: data?.updated_at,
    }

    return NextResponse.json({ success: true, settings: merged })
  } catch (err: any) {
    console.error('Failed to fetch settings:', err)
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

    // 1. Fetch current stored credentials first so we don't wipe existing secrets when masked
    const currentCreds = await getDynamicCredentials(true)

    // 2. Resolve credentials to update
    const resolvedMetaAccessToken =
      body.metaAccessToken && !isMasked(body.metaAccessToken)
        ? body.metaAccessToken.trim()
        : currentCreds.metaAccessToken

    const resolvedMetaPhoneNumberId =
      typeof body.metaPhoneNumberId === 'string'
        ? body.metaPhoneNumberId.trim()
        : currentCreds.metaPhoneNumberId

    const resolvedMetaVerifyToken =
      body.metaVerifyToken && !isMasked(body.metaVerifyToken)
        ? body.metaVerifyToken.trim()
        : currentCreds.metaVerifyToken

    const resolvedGoogleCalendarId =
      typeof body.googleCalendarId === 'string'
        ? body.googleCalendarId.trim()
        : currentCreds.googleCalendarId

    const resolvedGoogleSheetId =
      typeof body.googleSheetId === 'string'
        ? body.googleSheetId.trim()
        : currentCreds.googleSheetId

    const resolvedGoogleServiceAccountJson =
      body.googleServiceAccountJson && !isMasked(body.googleServiceAccountJson)
        ? body.googleServiceAccountJson.trim()
        : currentCreds.googleServiceAccountJson

    const resolvedGeminiApiKey =
      body.geminiApiKey && !isMasked(body.geminiApiKey)
        ? body.geminiApiKey.trim()
        : currentCreds.geminiApiKey

    // 3. Build standard clinic payload
    const clinicPayload: any = {
      clinic_name: body.clinicName || body.clinic_name || currentCreds.clinicName,
      doctor_name: body.doctorName || body.doctor_name || currentCreds.doctorName,
      address: body.address !== undefined ? body.address : currentCreds.clinicAddress,
      phone: body.phone !== undefined ? body.phone : currentCreds.clinicPhone,
      timings_start: body.timingsStart || body.timings_start || currentCreds.timingsStart,
      timings_end: body.timingsEnd || body.timings_end || currentCreds.timingsEnd,
      lunch_start: body.lunchStart || body.lunch_start || currentCreds.lunchStart,
      lunch_end: body.lunchEnd || body.lunch_end || currentCreds.lunchEnd,
      weekly_off: body.weeklyOff || body.weekly_off || currentCreds.weeklyOff,
      consultation_fee: Number(body.consultationFee ?? body.consultation_fee ?? currentCreds.consultationFee),
      services: body.services || [],
      faqs: body.faqs || [],
      google_sheet_id: resolvedGoogleSheetId,
      google_calendar_id: resolvedGoogleCalendarId,
      knowledge_base_text: body.knowledgeBaseText || body.knowledge_base_text || '',
      updated_at: new Date().toISOString(),
    }

    // Try including integration columns directly in clinicPayload
    const fullPayload: any = {
      ...clinicPayload,
      meta_access_token: resolvedMetaAccessToken,
      meta_phone_number_id: resolvedMetaPhoneNumberId,
      meta_verify_token: resolvedMetaVerifyToken,
      google_service_account_json: resolvedGoogleServiceAccountJson,
      gemini_api_key: resolvedGeminiApiKey,
    }

    // Check existing clinic_settings row
    const { data: existing } = await supabase
      .from('clinic_settings')
      .select('id')
      .limit(1)
      .maybeSingle()

    // 4. Try updating clinic_settings with fullPayload; fallback to clinicPayload if columns don't exist yet
    let dbUpdated = false
    try {
      if (existing?.id) {
        const { error } = await supabase
          .from('clinic_settings')
          .update(fullPayload)
          .eq('id', existing.id)
        if (!error) dbUpdated = true
      } else {
        const { error } = await supabase.from('clinic_settings').insert([fullPayload])
        if (!error) dbUpdated = true
      }
    } catch {
      dbUpdated = false
    }

    if (!dbUpdated) {
      // Fallback: update standard columns only
      if (existing?.id) {
        await supabase
          .from('clinic_settings')
          .update(clinicPayload)
          .eq('id', existing.id)
      } else {
        await supabase.from('clinic_settings').insert([clinicPayload])
      }
    }

    // 5. Always persist integration credentials to knowledge_base with source_name = 'clinic_integrations'
    const integrationMetadata = {
      meta_access_token: resolvedMetaAccessToken,
      meta_phone_number_id: resolvedMetaPhoneNumberId,
      meta_verify_token: resolvedMetaVerifyToken,
      google_calendar_id: resolvedGoogleCalendarId,
      google_sheet_id: resolvedGoogleSheetId,
      google_service_account_json: resolvedGoogleServiceAccountJson,
      gemini_api_key: resolvedGeminiApiKey,
      updated_at: new Date().toISOString(),
    }

    const { data: existingKb } = await supabase
      .from('knowledge_base')
      .select('id')
      .eq('source_name', 'clinic_integrations')
      .maybeSingle()

    if (existingKb?.id) {
      await supabase
        .from('knowledge_base')
        .update({
          metadata: integrationMetadata,
          content: 'Dynamic integrations credentials store',
        })
        .eq('id', existingKb.id)
    } else {
      await supabase.from('knowledge_base').insert([
        {
          source_name: 'clinic_integrations',
          content: 'Dynamic integrations credentials store',
          metadata: integrationMetadata,
        },
      ])
    }

    // 6. Immediately invalidate in-memory cache
    invalidateCredentialsCache()

    // 7. Notify backend Express server (port 3001) to invalidate its cache immediately
    const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
    try {
      await fetch(`${serverUrl}/api/settings/invalidate-cache`, { method: 'POST' })
    } catch {}

    console.log('✅ [POST /api/settings] Credentials & settings saved and cache invalidated.')

    return NextResponse.json({
      success: true,
      message: 'Clinic settings and credentials updated successfully.',
    })
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
