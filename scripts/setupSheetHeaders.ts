/**
 * scripts/setupSheetHeaders.ts
 * Standalone CLI script to initialize Google Sheet tabs & headers for a new dental clinic client.
 *
 * Usage:
 *   npx ts-node scripts/setupSheetHeaders.ts
 *   or:
 *   node --loader ts-node/esm scripts/setupSheetHeaders.ts
 */

import { google } from 'googleapis'
import path from 'path'
import fs from 'fs'

// Load .env.local from project root
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  content.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim()
      let v = trimmed.slice(idx + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[k]) process.env[k] = v
    }
  })
}

const APPOINTMENT_HEADERS = [
  'Booking ID',
  'Date',
  'Time Slot',
  'Patient Name',
  'Phone Number',
  'Dental Issue',
  'Status',
  'Created Timestamp',
]

const PATIENTS_LEADS_HEADERS = [
  'Patient Name',
  'WhatsApp Number',
  'First Contact Date',
  'Last Query Summary',
]

async function run() {
  console.log('\n🦷 === Google Sheets Dental SaaS Tab & Header Initializer ===\n')

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  let rawKey = process.env.GOOGLE_PRIVATE_KEY || ''
  if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
    rawKey = rawKey.slice(1, -1)
  }
  const privateKey = rawKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()

  let sheetId = (process.env.GOOGLE_SHEET_ID || '').trim()
  const match = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match && match[1]) {
    sheetId = match[1]
  }

  if (!clientEmail || !privateKey) {
    console.error('❌ Error: GOOGLE_CLIENT_EMAIL (or GOOGLE_SERVICE_ACCOUNT_EMAIL) and GOOGLE_PRIVATE_KEY must be set in .env.local')
    process.exit(1)
  }

  if (!sheetId) {
    console.error('❌ Error: GOOGLE_SHEET_ID is missing in .env.local')
    process.exit(1)
  }

  console.log(`📡 Connecting with service account: ${clientEmail}`)
  console.log(`📄 Target Google Sheet ID: ${sheetId}\n`)

  const jsonPath = path.resolve(process.cwd(), 'service-account.json')
  let auth
  if (fs.existsSync(jsonPath)) {
    console.log(`🔑 Using credentials directly from local ${jsonPath}`)
    auth = new google.auth.GoogleAuth({
      keyFile: jsonPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
  } else {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
  }

  const sheets = google.sheets({ version: 'v4', auth })

  try {
    // 1. Fetch spreadsheet info
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId })
    console.log(`✅ Connected to Spreadsheet: "${meta.data.properties?.title}"`)

    const existingSheets = meta.data.sheets || []
    const existingTitles = existingSheets.map((s) => s.properties?.title).filter(Boolean) as string[]

    const requests: any[] = []

    // 2. Check and add "Appointments" tab
    if (!existingTitles.includes('Appointments')) {
      console.log('➕ Creating "Appointments" tab...')
      requests.push({
        addSheet: {
          properties: {
            title: 'Appointments',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      })
    } else {
      console.log('ℹ️ "Appointments" tab already exists.')
    }

    // 3. Check and add "Patients_Leads" tab
    if (!existingTitles.includes('Patients_Leads')) {
      console.log('➕ Creating "Patients_Leads" tab...')
      requests.push({
        addSheet: {
          properties: {
            title: 'Patients_Leads',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      })
    } else {
      console.log('ℹ️ "Patients_Leads" tab already exists.')
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests },
      })
      console.log('✅ Tabs created successfully.')
    }

    // 4. Update Header rows in both tabs
    console.log('✍️ Writing column headers to Row 1...')
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
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

    console.log('\n🎉 SUCCESS! Client Google Sheet is fully initialized.')
    console.log('Columns in Appointments: ' + APPOINTMENT_HEADERS.join(' | '))
    console.log('Columns in Patients_Leads: ' + PATIENTS_LEADS_HEADERS.join(' | '))
    console.log('\nYou can now share this Google Sheet with your dental clinic client!')
  } catch (err: any) {
    console.error('\n❌ Failed to setup Google Sheet:', err.message)
    if (err.message.includes('permission') || err.message.includes('403') || err.message.includes('404')) {
      console.error(
        `💡 Tip: Make sure you shared the Google Sheet with Editor permission to:\n👉 ${clientEmail}`
      )
    }
    process.exit(1)
  }
}

run()
