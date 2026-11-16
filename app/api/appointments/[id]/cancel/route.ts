import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { deleteCalendarEvent } from '@/lib/googleCalendar'
import { sendTextMessage } from '@/lib/metaWhatsapp'
import { getExactWeekday } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Appointment ID is required' }, { status: 400 })
    }

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

    // 2. Fetch clinic settings for calendar ID & clinic info
    const { data: clinicSettings } = await supabase
      .from('clinic_settings')
      .select('clinic_name, google_calendar_id')
      .limit(1)
      .maybeSingle()

    const clinicName = clinicSettings?.clinic_name || "Dr. Sharma's Dental Clinic"
    const calendarId = clinicSettings?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID

    // 3. Delete from Google Calendar if event exists
    if (appt.google_event_id && calendarId) {
      try {
        await deleteCalendarEvent(appt.google_event_id, calendarId, appt.appointment_date)
      } catch (calErr: any) {
        console.warn('[Calendar Warning] Failed to delete calendar event during cancel:', calErr?.message)
      }
    }

    // 4. Update appointment status in Supabase
    const { data: updatedAppt, error: updateErr } = await supabase
      .from('appointments')
      .update({
        status: 'Cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appt.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // 5. Calculate programmatic weekday
    const weekday = getExactWeekday(appt.appointment_date)
    const dateFormatted = weekday ? `${appt.appointment_date}, ${weekday}` : appt.appointment_date

    // 6. Send polite WhatsApp cancellation notification
    let whatsappSent = false
    let whatsappError: string | undefined
    if (appt.patient_phone && appt.patient_phone !== '[UNKNOWN]') {
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
        if (!metaRes.success) whatsappError = metaRes.error
      } catch (wErr: any) {
        console.warn('[WhatsApp Warning] Failed to dispatch cancellation WhatsApp message:', wErr?.message)
        whatsappError = wErr?.message
      }

      // 7. Log cancellation message into chat_messages if conversation exists
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
          content: `[Receptionist cancelled appointment ${appt.booking_id} for ${dateFormatted} at ${appt.time_slot}]`,
          created_at: new Date().toISOString(),
        })
      }
    }

    return NextResponse.json({
      success: true,
      appointment: updatedAppt,
      whatsappSent,
      whatsappError,
      message: `Appointment ${appt.booking_id} has been cancelled successfully.`,
    })
  } catch (err: any) {
    console.error('Error cancelling appointment:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to cancel appointment' },
      { status: 500 }
    )
  }
}
