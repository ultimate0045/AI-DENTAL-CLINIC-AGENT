export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkSheetsConnection } from '@/lib/googleSheets'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    let sheetId: string | null | undefined = searchParams.get('sheetId')

    console.log('[GET /api/sheets/status] Received request with query sheetId:', sheetId)

    if (!sheetId) {
      try {
        const supabase = createAdminClient()
        const { data } = await supabase
          .from('clinic_settings')
          .select('google_sheet_id')
          .limit(1)
          .maybeSingle()

        sheetId = data?.google_sheet_id || process.env.GOOGLE_SHEET_ID
      } catch (dbErr: any) {
        console.warn('[GET /api/sheets/status] Could not read sheetId from Supabase, falling back to process.env:', dbErr?.message)
        sheetId = process.env.GOOGLE_SHEET_ID
      }
    }

    if (!sheetId || sheetId === 'your_google_sheet_id_here') {
      return NextResponse.json({
        success: false,
        connected: false,
        error: 'No Google Sheet ID provided or configured. Please enter your Google Sheet ID in Settings.',
      })
    }

    const res = await checkSheetsConnection(sheetId)

    if (!res.success) {
      console.error(`❌ [GET /api/sheets/status] Connection failed for sheet "${sheetId}":`, res.error)
    } else {
      console.log(`✅ [GET /api/sheets/status] Connected successfully to "${res.title}"`)
    }

    return NextResponse.json({
      success: res.success,
      connected: res.success,
      title: res.title,
      error: res.error,
    })
  } catch (err: any) {
    console.error('❌ [GET /api/sheets/status Uncaught Exception]:', err?.message || err, err?.stack)
    return NextResponse.json({
      success: false,
      connected: false,
      error: err?.message || 'Connection check failed unexpectedly.',
    })
  }
}
