import { NextResponse } from 'next/server'
import { setupSheetHeaders } from '@/lib/googleSheets'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    let sheetId: string | undefined

    try {
      const body = await request.json()
      sheetId = body?.sheetId || body?.googleSheetId
    } catch {
      // Body may be empty
    }

    console.log('[POST /api/sheets/setup] Request body sheetId:', sheetId)

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
        console.warn('[POST /api/sheets/setup] Could not read from Supabase, falling back to process.env:', dbErr?.message)
        sheetId = process.env.GOOGLE_SHEET_ID
      }
    }

    if (!sheetId || sheetId === 'your_google_sheet_id_here') {
      console.error('❌ [POST /api/sheets/setup] Invalid or placeholder Google Sheet ID provided.')
      return NextResponse.json(
        { success: false, error: 'Google Sheet ID is not configured or provided. Please enter a valid Sheet ID.' },
        { status: 400 }
      )
    }

    console.log(`🚀 [POST /api/sheets/setup] Executing setupSheetHeaders for Sheet ID: "${sheetId}"`)
    const res = await setupSheetHeaders(sheetId)
    console.log(`✅ [POST /api/sheets/setup] Setup succeeded:`, res.message)
    return NextResponse.json(res)
  } catch (err: any) {
    const errorMsg = err?.response?.data?.error?.message || err?.message || 'Failed to set up Google Sheet headers.'
    console.error('❌ [POST /api/sheets/setup Error]:', {
      error: errorMsg,
      status: err?.response?.status,
      stack: err?.stack,
    })
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    )
  }
}
