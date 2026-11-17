import { google } from 'googleapis'
import { parseGooglePrivateKey } from './utils'

import fs from 'fs'
import path from 'path'

export const APPOINTMENT_HEADERS = [
  'Booking ID',
  'Date',
  'Time Slot',
  'Patient Name',
  'Phone Number',
  'Dental Issue',
  'Status',
  'Created Timestamp',
]

export const PATIENTS_LEADS_HEADERS = [
  'Patient Name',
  'WhatsApp Number',
  'First Contact Date',
  'Last Query Summary',
]

export interface SheetAppointment {
  bookingId: string
  date: string
  timeSlot: string
  patientName: string
  phone: string
  dentalIssue: string
  status?: string
  timestamp?: string
}

export interface SheetPatientLead {
  patientName: string
  phone: string
  firstContactDate?: string
  lastQuery: string
}

/**
 * Strips full URL if user pasted "https://docs.google.com/spreadsheets/d/<ID>/edit..."
 */
export function cleanSheetId(input?: string): string {
  if (!input) return ''
  let id = input.trim()

  // Match /spreadsheets/d/([a-zA-Z0-9-_]+)
  const match = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match && match[1]) {
    return match[1]
  }

  // Remove trailing slashes or queries
  id = id.split('/')[0].split('?')[0].trim()
  return id
}

/**
 * Returns authenticated Google auth client for Google Sheets
 */
export function getSheetsAuthClient(serviceAccountJson?: string) {
  const jsonToUse =
    serviceAccountJson ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_CREDENTIALS_JSON

  if (jsonToUse && jsonToUse.trim()) {
    try {
      const parsed = typeof jsonToUse === 'string' ? JSON.parse(jsonToUse) : jsonToUse
      if (parsed.client_email && (parsed.private_key || parsed.privateKey)) {
        return new google.auth.GoogleAuth({
          credentials: {
            client_email: parsed.client_email,
            private_key: parseGooglePrivateKey(parsed.private_key || parsed.privateKey),
          },
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        })
      }
    } catch (e: any) {
      console.warn('[GoogleSheets] Error parsing custom serviceAccountJson:', e?.message)
    }
  }

  const jsonPath = path.join(process.cwd(), 'service-account.json')
  if (fs.existsSync(jsonPath)) {
    return new google.auth.GoogleAuth({
      keyFile: jsonPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
  }

  const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_PRIVATE_KEY
  const key = parseGooglePrivateKey(rawKey)

  if (!email || !key) {
    console.error('❌ [Google Sheets Auth Error] Missing credentials in environment:', {
      hasClientEmail: Boolean(process.env.GOOGLE_CLIENT_EMAIL),
      hasServiceAccountEmail: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      hasPrivateKey: Boolean(rawKey),
      keyLength: key ? key.length : 0,
    })
    throw new Error(
      `Google service account credentials missing. Email set: ${Boolean(email)}, Key set: ${Boolean(key)}`
    )
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

/**
 * Returns authenticated Google Sheets client instance
 */
export function getSheetsClient(serviceAccountJson?: string) {
  const auth = getSheetsAuthClient(serviceAccountJson)
  return google.sheets({ version: 'v4', auth })
}

/**
 * Resolves and cleans the Google Sheet ID from passed argument or environment
 */
export function resolveSheetId(sheetId?: string): string {
  const rawId = sheetId || process.env.GOOGLE_SHEET_ID
  const cleaned = cleanSheetId(rawId)
  if (!cleaned) {
    throw new Error('Google Sheet ID is not provided or set in environment variables.')
  }
  return cleaned
}

/**
 * Check if the Google Sheet can be accessed
 */
export async function checkSheetsConnection(
  sheetId?: string
): Promise<{ success: boolean; title?: string; error?: string }> {
  try {
    const id = resolveSheetId(sheetId)
    console.log(`📡 [Google Sheets] Testing connection for Sheet ID: "${id}"...`)
    const sheets = getSheetsClient()
    const res = await sheets.spreadsheets.get({ spreadsheetId: id })
    const title = res.data.properties?.title || 'Connected Sheet'
    console.log(`✅ [Google Sheets] Successfully connected to "${title}" (ID: ${id})`)
    return {
      success: true,
      title,
    }
  } catch (err: any) {
    const apiError = err?.response?.data?.error?.message || err?.message || 'Failed to connect to Google Sheets'
    console.error('❌ [Google Sheets Connection Error]:', {
      error: apiError,
      status: err?.response?.status,
      details: err?.response?.data?.error?.errors,
    })
    return {
      success: false,
      error: apiError,
    }
  }
}

/**
 * Set up 'Appointments' and 'Patients_Leads' tabs and their header rows in the target Google Sheet.
 */
export async function setupSheetHeaders(sheetId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const id = resolveSheetId(sheetId)
    console.log(`📋 [Google Sheets Setup] Initializing tabs for Sheet ID: "${id}"...`)
    const sheets = getSheetsClient()

    // 1. Fetch existing sheets/tabs
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id })
    const existingTitles = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[]
    console.log(`📄 [Google Sheets Setup] Existing tabs: [${existingTitles.join(', ')}]`)

    const requests: any[] = []

    // Add Appointments sheet if missing
    if (!existingTitles.includes('Appointments')) {
      console.log('➕ [Google Sheets Setup] Queueing tab: "Appointments"')
      requests.push({
        addSheet: {
          properties: {
            title: 'Appointments',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      })
    }

    // Add Patients_Leads sheet if missing
    if (!existingTitles.includes('Patients_Leads')) {
      console.log('➕ [Google Sheets Setup] Queueing tab: "Patients_Leads"')
      requests.push({
        addSheet: {
          properties: {
            title: 'Patients_Leads',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      })
    }

    if (requests.length > 0) {
      console.log(`🚀 [Google Sheets Setup] Applying batchUpdate with ${requests.length} requests...`)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests },
      })
      console.log('✅ [Google Sheets Setup] Tabs created.')
    }

    // Set / overwrite headers in Row 1 for both tabs
    console.log('✍️ [Google Sheets Setup] Writing headers to Appointments!A1:H1 and Patients_Leads!A1:D1...')
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: 'Appointments!A1:H1',
            values: [APPOINTMENT_HEADERS],
          },
          {
            range: 'Patients_Leads!A1:D1',
            values: [PATIENTS_LEADS_HEADERS],
          },
        ],
      },
    })

    console.log('🎉 [Google Sheets Setup] Headers set up successfully!')
    return {
      success: true,
      message: 'Google Sheet tabs (Appointments & Patients_Leads) and headers configured successfully.',
    }
  } catch (err: any) {
    const apiError = err?.response?.data?.error?.message || err?.message || 'Failed to setup Google Sheet headers'
    console.error('❌ [Google Sheets Setup Error]:', {
      error: apiError,
      status: err?.response?.status,
      details: err?.response?.data?.error?.errors,
    })
    throw new Error(apiError)
  }
}

/**
 * Append an appointment row to the Appointments tab
 */
export async function appendAppointment(
  data: SheetAppointment,
  sheetId?: string
): Promise<{ success: boolean; updatedRange?: string }> {
  try {
    const id = resolveSheetId(sheetId)
    const sheets = getSheetsClient()

    const row = [
      data.bookingId,
      data.date,
      data.timeSlot,
      data.patientName,
      data.phone,
      data.dentalIssue || 'Dental Consultation',
      data.status || 'Confirmed',
      data.timestamp || new Date().toISOString(),
    ]

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: 'Appointments!A:H',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row],
      },
    })

    return {
      success: true,
      updatedRange: response.data.updates?.updatedRange || undefined,
    }
  } catch (err: any) {
    console.error('❌ [Google Sheets appendAppointment Error]:', err?.response?.data || err.message)
    throw err
  }
}

/**
 * Log or update patient in Patients_Leads tab (match by phone number)
 */
export async function upsertPatientLead(
  lead: SheetPatientLead,
  sheetId?: string
): Promise<{ success: boolean; action: 'updated' | 'inserted' }> {
  try {
    const id = resolveSheetId(sheetId)
    const sheets = getSheetsClient()

    // 1. Read existing rows to check if phone number exists
    let rows: string[][] = []
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: 'Patients_Leads!A:D',
      })
      rows = (res.data.values as string[][]) || []
    } catch {
      // tab might be missing, try setup
      await setupSheetHeaders(id)
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: 'Patients_Leads!A:D',
      })
      rows = (res.data.values as string[][]) || []
    }

    const cleanTargetPhone = lead.phone.replace(/\D/g, '')
    let existingRowIndex = -1

    for (let i = 1; i < rows.length; i++) {
      const existingPhone = (rows[i][1] || '').replace(/\D/g, '')
      if (existingPhone && cleanTargetPhone.endsWith(existingPhone.slice(-10))) {
        existingRowIndex = i
        break
      }
    }

    const now = new Date().toISOString()

    if (existingRowIndex !== -1) {
      // Update existing row
      const rowNum = existingRowIndex + 1
      const firstContact = rows[existingRowIndex][2] || lead.firstContactDate || now
      const updatedRow = [
        lead.patientName || rows[existingRowIndex][0] || 'Unknown',
        lead.phone,
        firstContact,
        lead.lastQuery,
      ]

      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Patients_Leads!A${rowNum}:D${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [updatedRow],
        },
      })

      return { success: true, action: 'updated' }
    } else {
      // Append new lead
      const newRow = [
        lead.patientName || 'New Patient',
        lead.phone,
        lead.firstContactDate || now,
        lead.lastQuery,
      ]

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: 'Patients_Leads!A:D',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [newRow],
        },
      })

      return { success: true, action: 'inserted' }
    }
  } catch (err: any) {
    console.error('❌ [Google Sheets upsertPatientLead Error]:', err?.response?.data || err.message)
    throw err
  }
}

/**
 * Fetch all appointments from the Appointments tab
 */
export async function getAppointmentsFromSheet(sheetId?: string): Promise<SheetAppointment[]> {
  const id = resolveSheetId(sheetId)
  const sheets = getSheetsClient()

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Appointments!A2:H',
  })

  const rows = res.data.values || []
  return rows.map((r) => ({
    bookingId: r[0] || '',
    date: r[1] || '',
    timeSlot: r[2] || '',
    patientName: r[3] || '',
    phone: r[4] || '',
    dentalIssue: r[5] || '',
    status: r[6] || 'Confirmed',
    timestamp: r[7] || '',
  }))
}

/**
 * Update the status of an appointment row in the Google Sheet's 'Appointments' tab
 */
export async function updateAppointmentStatusInSheet(params: {
  bookingId?: string
  phone?: string
  date?: string
  timeSlot?: string
  status: string
  sheetId?: string
  serviceAccountJson?: string
}): Promise<{ success: boolean; updatedRow?: number; error?: string }> {
  try {
    const id = resolveSheetId(params.sheetId)
    if (!id) {
      return { success: false, error: 'Google Sheet ID not configured' }
    }
    const sheets = getSheetsClient(params.serviceAccountJson)

    // 1. Fetch rows from Appointments tab
    let res: any
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: 'Appointments!A:H',
      })
    } catch (readErr: any) {
      console.warn('[Google Sheets] Appointments tab read error:', readErr?.message)
      await setupSheetHeaders(id)
      return { success: false, error: 'Sheet initialized, row not found' }
    }

    const rows: string[][] = res.data.values || []
    if (rows.length < 2) {
      return { success: false, error: 'No appointment rows in sheet' }
    }

    // Determine status column index from header (row 0)
    const headers = rows[0] || []
    let statusColIdx = headers.findIndex((h: any) =>
      typeof h === 'string' && h.toLowerCase().trim() === 'status'
    )
    if (statusColIdx === -1) {
      // Default to column G (index 6) as defined in APPOINTMENT_HEADERS
      statusColIdx = 6
    }

    const targetBookingId = (params.bookingId || '').trim().toLowerCase()
    const targetPhoneDigits = (params.phone || '').replace(/\D/g, '').slice(-10)
    const targetDate = (params.date || '').trim()

    let matchedRowIndex = -1 // 0-based index in rows array

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const rowBookingId = (row[0] || '').trim().toLowerCase()
      const rowDate = (row[1] || '').trim()
      const rowPhone = (row[4] || '').replace(/\D/g, '')

      // Match 1: Booking ID match
      if (targetBookingId && rowBookingId) {
        if (
          rowBookingId === targetBookingId ||
          rowBookingId.includes(targetBookingId) ||
          targetBookingId.includes(rowBookingId)
        ) {
          matchedRowIndex = i
          break
        }
      }

      // Match 2: Phone number (+ optional Date) match
      if (targetPhoneDigits && rowPhone) {
        const phoneMatches =
          rowPhone.endsWith(targetPhoneDigits) || targetPhoneDigits.endsWith(rowPhone.slice(-10))
        if (phoneMatches) {
          if (!targetDate || rowDate === targetDate) {
            matchedRowIndex = i
            break
          }
        }
      }
    }

    if (matchedRowIndex === -1) {
      console.warn(
        `[Google Sheets] No matching row found to update status for bookingId: "${params.bookingId}", phone: "${params.phone}"`
      )
      return { success: false, error: 'Appointment row not found in sheet' }
    }

    const rowNum = matchedRowIndex + 1 // 1-based row number for Sheets API
    const colLetter = String.fromCharCode(65 + statusColIdx) // e.g. 'G'
    const updateRange = `Appointments!${colLetter}${rowNum}`

    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[params.status]],
      },
    })

    console.log(`✅ [Google Sheets] Updated status to "${params.status}" at ${updateRange}`)
    return { success: true, updatedRow: rowNum }
  } catch (err: any) {
    const errMsg =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Failed to update appointment status in sheet'
    console.error('❌ [Google Sheets updateAppointmentStatusInSheet Error]:', errMsg)
    return { success: false, error: errMsg }
  }
}
