import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import {
  checkAvailability,
  bookCalendarAppointment,
  deleteCalendarEvent,
  WorkingHoursConfig,
} from '@/lib/googleCalendar'
import { sendTextMessage } from '@/lib/metaWhatsapp'
import { getExactWeekday, normalizeDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function normalizeSlotTo24h(slot: string): string {
  if (!slot) return ''
  const trimmed = slot.trim()
  const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return trimmed
  let h = parseInt(m[1], 10)
  const min = m[2]
  const ampm = (m[3] || '').toUpperCase()
  if (ampm === 'PM' && h < 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Appointment ID is required' }, { status: 400 })
    }

    const body = await request.json()
    const rawDate = body.appointment_date || body.date
    const rawSlot = body.time_slot || body.timeSlot

    if (!rawDate || !rawSlot) {
      return NextResponse.json(
        { success: false, error: 'Both appointment_date and time_slot are required for rescheduling.' },
        { status: 400 }
      )
    }

    const newDate = normalizeDate(rawDate) || rawDate
    const newSlot24 = normalizeSlotTo24h(rawSlot)

    const supabase = createAdminClient()

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    const filterCol = isUuid ? 'id' : 'booking_id'

    // 1. Fetch current appointment
    const { data: appt, error: fetchErr } = await supabase
      .from('appointments')
      .select('*')
      .eq(filterCol, id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 })
    }

    // 2. Fetch clinic settings for working hours and calendar ID
    const { data: clinicSettings } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    const workingHours: WorkingHoursConfig = {
      timingsStart: clinicSettings?.timings_start || '09:00',
      timingsEnd: clinicSettings?.timings_end || '18:00',
      lunchStart: clinicSettings?.lunch_start || '13:00',
      lunchEnd: clinicSettings?.lunch_end || '14:00',
      weeklyOff: clinicSettings?.weekly_off || 'Sunday',
      slotDurationMinutes: 30,
    }

    const calendarId = clinicSettings?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID
    const clinicName = clinicSettings?.clinic_name || "Dr. Sharma's Dental Clinic"
    const clinicAddress = clinicSettings?.address || 'Suite 402, Dental Care Plaza, Metro Station Road'

    // 3. Verify calendar availability for new slot
    let availableSlots: string[] = []
    let isOffDay = false
    let offReason: string | undefined

    if (calendarId) {
      const availResult = await checkAvailability(newDate, workingHours, calendarId)
      isOffDay = availResult.isOffDay
      offReason = availResult.reason
      availableSlots = availResult.availableSlots || []

      if (isOffDay) {
        return NextResponse.json(
          {
            success: false,
            error: offReason || `The clinic is closed on ${workingHours.weeklyOff}s. Please pick another date.`,
          },
          { status: 400 }
        )
      }

      // Check if requested slot is available
      const slotMatched = availableSlots.some((s) => {
        return normalizeSlotTo24h(s) === newSlot24
      })

      if (!slotMatched && availableSlots.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `The slot ${rawSlot} is not available on ${newDate}. Available slots: ${availableSlots.slice(0, 6).join(', ')}`,
            availableSlots,
          },
          { status: 400 }
        )
      }
    }

    // 4. Delete old calendar event if existed
    if (appt.google_event_id && calendarId) {
      try {
        await deleteCalendarEvent(appt.google_event_id, calendarId, appt.appointment_date)
      } catch (delErr: any) {
        console.warn('[Calendar Warning] Failed to delete old calendar event:', delErr?.message)
      }
    }

    // 5. Create new calendar event
    let newEventId: string | null = null
    if (calendarId) {
      try {
        const calRes = await bookCalendarAppointment(
          {
            patientName: appt.patient_name,
            patientPhone: appt.patient_phone,
            dentalIssue: appt.dental_issue || 'Dental Consultation',
            date: newDate,
            timeSlot: newSlot24,
            durationMinutes: 30,
            visitType: appt.dental_issue?.toLowerCase().includes('regular') ? 'returning' : 'first-time',
          },
          calendarId
        )
        if (calRes.success && calRes.eventId) {
          newEventId = calRes.eventId
        }
      } catch (bErr: any) {
        console.warn('[Calendar Warning] Failed to create new calendar event on reschedule:', bErr?.message)
      }
    }

    // 6. Update appointment in Supabase
    const { data: updatedAppt, error: updateErr } = await supabase
      .from('appointments')
      .update({
        appointment_date: newDate,
        time_slot: rawSlot, // Preserve display format (e.g. 11:30 AM or 11:30)
        status: 'Confirmed',
        google_event_id: newEventId || appt.google_event_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appt.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // 7. Calculate programmatic weekday
    const weekday = getExactWeekday(newDate)
    const dateFormatted = weekday ? `${newDate}, ${weekday}` : newDate

    // 8. Send WhatsApp notification
    let whatsappSent = false
    let whatsappError: string | undefined
    if (appt.patient_phone && appt.patient_phone !== '[UNKNOWN]') {
      const rescheduleMsg =
        `Aapki appointment successfully reschedule ho gayi hai! 🎉\n\n` +
        `📋 Booking ID: ${appt.booking_id}\n` +
        `👤 Patient: ${appt.patient_name}\n` +
        `📅 New Date: ${dateFormatted}\n` +
        `⏰ New Time: ${rawSlot}\n` +
        `📍 Clinic: ${clinicAddress}\n\n` +
        `Dr. Sharma and our team look forward to seeing you. Please arrive 10 minutes prior to your slot. Let us know if you need to make any further changes! 😊`

      try {
        const metaRes = await sendTextMessage(appt.patient_phone, rescheduleMsg)
        whatsappSent = metaRes.success
        if (!metaRes.success) whatsappError = metaRes.error
      } catch (wErr: any) {
        console.warn('[WhatsApp Warning] Failed to dispatch reschedule message:', wErr?.message)
        whatsappError = wErr?.message
      }

      // 9. Log into chat_messages
      let convId = appt.conversation_id
      if (!convId) {
        const cleanPhone = appt.patient_phone.replace(/\D/g, '').slice(-10)
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .ilike('phone_number', `%${cleanPhone}%`)
          .limit(1)
          .maybeSingle()
        if (conv) convId = conv.id
      }

      if (convId) {
        await supabase.from('chat_messages').insert({
          conversation_id: convId,
          role: 'assistant',
          content: `[Receptionist rescheduled appointment ${appt.booking_id} to ${dateFormatted} at ${rawSlot}]`,
          created_at: new Date().toISOString(),
        })
      }
    }

    return NextResponse.json({
      success: true,
      appointment: updatedAppt,
      whatsappSent,
      whatsappError,
      message: `Appointment ${appt.booking_id} has been rescheduled to ${dateFormatted} at ${rawSlot}.`,
    })
  } catch (err: any) {
    console.error('Error rescheduling appointment:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to reschedule appointment' },
      { status: 500 }
    )
  }
}
