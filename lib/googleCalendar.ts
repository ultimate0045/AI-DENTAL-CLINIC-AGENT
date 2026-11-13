import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { parseGooglePrivateKey, generateTimeSlots } from './utils'

export interface WorkingHoursConfig {
  timingsStart?: string
  timingsEnd?: string
  lunchStart?: string
  lunchEnd?: string
  weeklyOff?: string
  slotDurationMinutes?: number
}

export interface BookCalendarParams {
  patientName: string
  patientPhone: string
  dentalIssue: string
  date: string // YYYY-MM-DD
  timeSlot: string // HH:MM
  durationMinutes?: number
}

export function getCalendarAuthClient() {
  const jsonPath = path.join(process.cwd(), 'service-account.json')
  if (fs.existsSync(jsonPath)) {
    return new google.auth.GoogleAuth({
      keyFile: jsonPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })
  }

  const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = parseGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY)

  if (!email || !key) {
    throw new Error('Google service account credentials (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY) are not set.')
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

export function getCalendarClient() {
  const auth = getCalendarAuthClient()
  return google.calendar({ version: 'v3', auth })
}

export function resolveCalendarId(calendarId?: string): string {
  const id = calendarId || process.env.GOOGLE_CALENDAR_ID || ''
  if (!id || id.includes('your_clinic_calendar_id') || id.includes('your_')) {
    return ''
  }
  return id
}

/**
 * Test Google Calendar connection
 */
export async function checkCalendarConnection(
  calendarId?: string
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    const id = resolveCalendarId(calendarId)
    if (!id) {
      return {
        success: false,
        error: 'Google Calendar ID is not configured or is placeholder in settings/.env',
      }
    }
    const calendar = getCalendarClient()
    const res = await calendar.calendars.get({ calendarId: id })
    return {
      success: true,
      summary: res.data.summary || 'Connected Calendar',
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to connect to Google Calendar',
    }
  }
}

/**
 * Check free 30-min slots for a given date
 */
export async function checkAvailability(
  date: string, // YYYY-MM-DD
  workingHours?: WorkingHoursConfig,
  calendarId?: string
): Promise<{ availableSlots: string[]; isOffDay: boolean; reason?: string }> {
  const id = resolveCalendarId(calendarId)
  const calendar = getCalendarClient()

  const timingsStart = workingHours?.timingsStart || '09:00'
  const timingsEnd = workingHours?.timingsEnd || '18:00'
  const lunchStart = workingHours?.lunchStart || '13:00'
  const lunchEnd = workingHours?.lunchEnd || '14:00'
  const weeklyOff = workingHours?.weeklyOff || 'Sunday'
  const slotDuration = workingHours?.slotDurationMinutes || 30

  // 1. Check weekly off
  const targetDate = new Date(`${date}T00:00:00`)
  const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' })

  if (weeklyOff && weeklyOff.toLowerCase() !== 'none' && dayName.toLowerCase() === weeklyOff.toLowerCase()) {
    return {
      availableSlots: [],
      isOffDay: true,
      reason: `Clinic is closed on ${weeklyOff}s`,
    }
  }

  // 2. Generate potential slots
  const allSlots = generateTimeSlots(timingsStart, timingsEnd, slotDuration)

  // 3. Filter out lunch break
  const slotsExcludingLunch = allSlots.filter((slot) => {
    const [h, m] = slot.split(':').map(Number)
    const slotMin = h * 60 + m

    const [lsh, lsm] = lunchStart.split(':').map(Number)
    const lunchStartMin = lsh * 60 + lsm

    const [leh, lem] = lunchEnd.split(':').map(Number)
    const lunchEndMin = leh * 60 + lem

    // Slot falls inside lunch
    return !(slotMin >= lunchStartMin && slotMin < lunchEndMin)
  })

  // 4. Fetch existing calendar events for the date
  const timeMin = new Date(`${date}T00:00:00.000Z`).toISOString()
  const timeMax = new Date(`${date}T23:59:59.999Z`).toISOString()

  let events: any[] = []
  if (id) {
    try {
      const calendar = getCalendarClient()
      const eventsRes = await calendar.events.list({
        calendarId: id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      })
      events = eventsRes.data.items || []
    } catch (err: any) {
      console.warn('[Calendar Warning] Error fetching calendar events:', err?.message)
    }
  }

  // 5. Filter out booked slots
  const bookedRanges = events
    .map((evt) => {
      const start = evt.start?.dateTime || evt.start?.date
      const end = evt.end?.dateTime || evt.end?.date
      if (!start || !end) return null
      return {
        start: new Date(start).getTime(),
        end: new Date(end).getTime(),
      }
    })
    .filter(Boolean) as { start: number; end: number }[]

  const freeSlots = slotsExcludingLunch.filter((slot) => {
    const slotStart = new Date(`${date}T${slot}:00`).getTime()
    const slotEnd = slotStart + slotDuration * 60 * 1000

    // Check collision with any booked event
    const collides = bookedRanges.some((range) => {
      return slotStart < range.end && slotEnd > range.start
    })

    return !collides
  })

  return {
    availableSlots: freeSlots,
    isOffDay: false,
  }
}

/**
 * Create an appointment in Google Calendar
 */
export async function bookCalendarAppointment(
  params: BookCalendarParams,
  calendarId?: string
): Promise<{ success: boolean; eventId?: string; htmlLink?: string; error?: string }> {
  try {
    const id = resolveCalendarId(calendarId)
    if (!id) {
      console.warn('[Calendar Warning] Calendar ID not configured or is a placeholder. Skipping Google Calendar event creation.')
      return {
        success: false,
        error: 'Google Calendar ID is not configured',
      }
    }
    const calendar = getCalendarClient()
    const duration = params.durationMinutes || 30

    const [h, m] = params.timeSlot.split(':').map(Number)
    const startDateTime = new Date(`${params.date}T${params.timeSlot}:00`)
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000)

    const event = {
      summary: `🦷 ${params.patientName} - ${params.dentalIssue || 'Dental Consultation'}`,
      description: `Patient: ${params.patientName}\nPhone: ${params.patientPhone}\nIssue: ${params.dentalIssue}\nBooked via WhatsApp AI Receptionist`,
      start: {
        dateTime: startDateTime.toISOString(),
      },
      end: {
        dateTime: endDateTime.toISOString(),
      },
      colorId: '2', // Sage green
    }

    const res = await calendar.events.insert({
      calendarId: id,
      requestBody: event,
    })

    return {
      success: true,
      eventId: res.data.id || undefined,
      htmlLink: res.data.htmlLink || undefined,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to create Google Calendar event',
    }
  }
}
