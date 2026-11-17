import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { deleteCalendarEvent } from '@/lib/googleCalendar'
import { updateAppointmentStatusInSheet } from '@/lib/googleSheets'
import { sendTextMessage } from '@/lib/metaWhatsapp'
import { getExactWeekday } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export function normalizeStatus(rawStatus?: string): string {
  if (!rawStatus) return 'Confirmed'
  const s = rawStatus.toLowerCase().trim()
  if (s.startsWith('comp')) return 'Completed'
  if (s.startsWith('canc')) return 'Cancelled'
  if (s.includes('not') || s.includes('no_show') || s.includes('no-show') || s.includes('noshow')) {
    return 'Not Visited'
  }
  if (s.startsWith('conf') || s.startsWith('sched')) return 'Confirmed'
  return rawStatus
}

export async function handleStatusUpdate(
  appointmentId: string,
  rawStatus: string,
  options: { notifyPatient?: boolean } = {}
) {
  if (!appointmentId) {
    return NextResponse.json({ success: false, error: 'Appointment ID is required' }, { status: 400 })
  }

  const normalizedStatus = normalizeStatus(rawStatus)
  const supabase = createAdminClient()

  // Match by UUID or booking_id
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)
  let apptQuery = supabase.from('appointments').select('*')
  if (isUuid) {
    apptQuery = apptQuery.eq('id', appointmentId)
  } else {
    apptQuery = apptQuery.eq('booking_id', appointmentId)
  }

  let { data: appt, error: fetchErr } = await apptQuery.maybeSingle()

  if (!appt) {
    // Fallback search across both id and booking_id
    const { data: fallbackAppt } = await supabase
      .from('appointments')
      .select('*')
      .or(`id.eq.${appointmentId},booking_id.eq.${appointmentId}`)
      .maybeSingle()
    appt = fallbackAppt
  }

  if (fetchErr || !appt) {
    return NextResponse.json(
      { success: false, error: 'Appointment not found' },
      { status: 404 }
    )
  }

  // Fetch clinic settings for dynamic Google credentials
  const { data: clinicSettings } = await supabase
    .from('clinic_settings')
    .select('clinic_name, google_calendar_id, google_sheet_id, google_service_account_json')
    .limit(1)
    .maybeSingle()

  const clinicName = clinicSettings?.clinic_name || "Dr. Sharma's Dental Clinic"
  const calendarId = clinicSettings?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID
  const sheetId = clinicSettings?.google_sheet_id || process.env.GOOGLE_SHEET_ID
  const serviceAccountJson = clinicSettings?.google_service_account_json

  // Step 1: Update status in Supabase appointments table
  const { data: updatedAppt, error: updateErr } = await supabase
    .from('appointments')
    .update({
      status: normalizedStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appt.id)
    .select()
    .single()

  if (updateErr) {
    throw updateErr
  }

  // Step 2: If status is Cancelled, delete event from Google Calendar so slot frees up
  let calendarDeleted = false
  if (normalizedStatus === 'Cancelled' && appt.google_event_id && calendarId) {
    try {
      const calRes = await deleteCalendarEvent(
        appt.google_event_id,
        calendarId,
        appt.appointment_date,
        serviceAccountJson
      )
      calendarDeleted = calRes.success
    } catch (calErr: any) {
      console.warn('[Calendar Warning] Failed to delete calendar event during cancel:', calErr?.message)
    }
  }

  // Step 3: Connect to Google Sheets API and update Status column
  let sheetsUpdated = false
  let sheetsError: string | undefined
  if (sheetId) {
    try {
      const sheetRes = await updateAppointmentStatusInSheet({
        bookingId: appt.booking_id,
        phone: appt.patient_phone,
        date: appt.appointment_date,
        timeSlot: appt.time_slot,
        status: normalizedStatus,
        sheetId,
        serviceAccountJson,
      })
      sheetsUpdated = sheetRes.success
      if (!sheetRes.success && sheetRes.error) {
        sheetsError = sheetRes.error
      }
    } catch (sErr: any) {
      console.warn('[Google Sheets Warning] Failed to update status in sheet:', sErr?.message)
      sheetsError = sErr?.message
    }
  }

  // Step 4: Optional polite WhatsApp cancellation dispatch if cancelled and notify requested
  let whatsappSent = false
  if (normalizedStatus === 'Cancelled' && options.notifyPatient && appt.patient_phone && appt.patient_phone !== '[UNKNOWN]') {
    const weekday = getExactWeekday(appt.appointment_date)
    const dateFormatted = weekday ? `${appt.appointment_date}, ${weekday}` : appt.appointment_date
    const cancellationMsg =
      `Dear ${appt.patient_name || 'Patient'},\n\n` +
      `Your dental appointment has been cancelled by ${clinicName}.\n\n` +
      `📋 Booking ID: ${appt.booking_id}\n` +
      `📅 Date: ${dateFormatted}\n` +
      `⏰ Time: ${appt.time_slot}\n\n` +
      `If you would like to reschedule or have any questions, please feel free to message us back directly. We apologize for any inconvenience! 🙏`

    try {
      const metaRes = await sendTextMessage(appt.patient_phone, cancellationMsg)
      whatsappSent = metaRes.success
    } catch (wErr: any) {
      console.warn('[WhatsApp Warning] Failed to dispatch cancellation WhatsApp message:', wErr?.message)
    }
  }

  return NextResponse.json({
    success: true,
    appointment: updatedAppt,
    status: normalizedStatus,
    calendarDeleted,
    sheetsUpdated,
    sheetsError,
    whatsappSent,
    message: `Status updated to ${normalizedStatus} & synced to Google Sheets.`,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    let body: any = {}
    try {
      body = await request.json()
    } catch {}

    const status = body?.status || 'Completed'
    const notifyPatient = Boolean(body?.notifyPatient)

    return await handleStatusUpdate(id, status, { notifyPatient })
  } catch (err: any) {
    console.error('Error updating appointment status:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update appointment status' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  return PATCH(request, { params })
}
