export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkCalendarConnection } from '@/lib/googleCalendar'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    let calendarId: string | null | undefined = searchParams.get('calendarId')

    console.log('[GET /api/calendar/status] Received query calendarId:', calendarId)

    if (!calendarId) {
      try {
        const supabase = createAdminClient()
        const { data } = await supabase
          .from('clinic_settings')
          .select('google_calendar_id')
          .limit(1)
          .maybeSingle()

        calendarId = data?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID
      } catch (dbErr: any) {
        console.warn('[GET /api/calendar/status] DB read failed, using env:', dbErr?.message)
        calendarId = process.env.GOOGLE_CALENDAR_ID
      }
    }

    if (!calendarId) {
      console.error('❌ [GET /api/calendar/status] No Google Calendar ID provided or configured.')
      return NextResponse.json({
        success: false,
        connected: false,
        error: 'No Google Calendar ID provided or configured.',
      })
    }

    const res = await checkCalendarConnection(calendarId)

    if (!res.success) {
      console.error(`❌ [GET /api/calendar/status] Connection failed for "${calendarId}":`, res.error)
    } else {
      console.log(`✅ [GET /api/calendar/status] Connected successfully to "${res.summary}"`)
    }

    return NextResponse.json({
      success: res.success,
      connected: res.success,
      summary: res.summary,
      error: res.error,
    })
  } catch (err: any) {
    console.error('❌ [GET /api/calendar/status Uncaught Exception]:', err?.message || err)
    return NextResponse.json({
      success: false,
      connected: false,
      error: err?.message || 'Calendar check failed unexpectedly.',
    })
  }
}
