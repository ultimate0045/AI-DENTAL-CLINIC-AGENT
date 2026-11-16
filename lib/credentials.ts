import { createAdminClient } from './supabase'

export interface DynamicCredentials {
  metaAccessToken: string
  metaPhoneNumberId: string
  metaVerifyToken: string
  googleCalendarId: string
  googleSheetId: string
  googleServiceAccountJson: string
  geminiApiKey: string
  geminiModel: string
  clinicName: string
  doctorName: string
  clinicAddress: string
  clinicPhone: string
  timingsStart: string
  timingsEnd: string
  lunchStart: string
  lunchEnd: string
  weeklyOff: string
  consultationFee: number
}

let cachedCredentials: DynamicCredentials | null = null
let cacheExpiresAt = 0
const CACHE_TTL_MS = 30 * 1000 // 30 seconds

export function invalidateCredentialsCache() {
  cachedCredentials = null
  cacheExpiresAt = 0
}

export function maskToken(val: string | undefined | null): string {
  if (!val || typeof val !== 'string') return ''
  const trimmed = val.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••••••'
  return '••••••••' + trimmed.slice(-4)
}

export function isMasked(val: string | undefined | null): boolean {
  if (!val || typeof val !== 'string') return false
  return val.includes('••••')
}

/**
 * Fetch dynamic credentials from Supabase clinic_settings + knowledge_base fallback,
 * falling back to process.env.*. Cached for 30s in memory.
 */
export async function getDynamicCredentials(forceFresh = false): Promise<DynamicCredentials> {
  const now = Date.now()
  if (!forceFresh && cachedCredentials && now < cacheExpiresAt) {
    return cachedCredentials
  }

  const supabase = createAdminClient()

  // 1. Fetch clinic_settings row
  let settingsRow: any = null
  try {
    const { data } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle()
    settingsRow = data
  } catch (err: any) {
    console.warn('[Credentials] Warning querying clinic_settings:', err?.message)
  }

  // 2. Fetch knowledge_base fallback row for credentials (source_name = 'clinic_integrations')
  let kbMetadata: any = {}
  try {
    const { data } = await supabase
      .from('knowledge_base')
      .select('metadata')
      .eq('source_name', 'clinic_integrations')
      .maybeSingle()
    if (data?.metadata) {
      kbMetadata = data.metadata
    }
  } catch (err: any) {
    // ignore
  }

  // 3. Resolve each credential with priority: clinic_settings -> knowledge_base -> process.env
  const metaAccessToken =
    settingsRow?.meta_access_token ||
    kbMetadata?.meta_access_token ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN ||
    ''

  const metaPhoneNumberId =
    settingsRow?.meta_phone_number_id ||
    kbMetadata?.meta_phone_number_id ||
    process.env.META_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    ''

  const metaVerifyToken =
    settingsRow?.meta_verify_token ||
    kbMetadata?.meta_verify_token ||
    process.env.META_VERIFY_TOKEN ||
    ''

  const googleCalendarId =
    settingsRow?.google_calendar_id ||
    kbMetadata?.google_calendar_id ||
    process.env.GOOGLE_CALENDAR_ID ||
    ''

  const googleSheetId =
    settingsRow?.google_sheet_id ||
    kbMetadata?.google_sheet_id ||
    process.env.GOOGLE_SHEET_ID ||
    ''

  const googleServiceAccountJson =
    settingsRow?.google_service_account_json ||
    kbMetadata?.google_service_account_json ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    ''

  const geminiApiKey =
    settingsRow?.gemini_api_key ||
    kbMetadata?.gemini_api_key ||
    process.env.GEMINI_API_KEY ||
    ''

  const geminiModel =
    settingsRow?.gemini_model ||
    kbMetadata?.gemini_model ||
    process.env.GEMINI_MODEL ||
    'gemini-1.5-flash'

  const credentials: DynamicCredentials = {
    metaAccessToken,
    metaPhoneNumberId,
    metaVerifyToken,
    googleCalendarId,
    googleSheetId,
    googleServiceAccountJson,
    geminiApiKey,
    geminiModel,
    clinicName: settingsRow?.clinic_name || process.env.CLINIC_NAME || 'Dental Care Clinic',
    doctorName: settingsRow?.doctor_name || process.env.CLINIC_DOCTOR || 'Dr. Sharma',
    clinicAddress: settingsRow?.address || process.env.CLINIC_ADDRESS || '123 Medical Enclave',
    clinicPhone: settingsRow?.phone || process.env.CLINIC_PHONE || '+91 98765 43210',
    timingsStart: (settingsRow?.timings_start || process.env.CLINIC_TIMINGS_START || '09:00').slice(0, 5),
    timingsEnd: (settingsRow?.timings_end || process.env.CLINIC_TIMINGS_END || '18:00').slice(0, 5),
    lunchStart: (settingsRow?.lunch_start || process.env.CLINIC_LUNCH_START || '13:00').slice(0, 5),
    lunchEnd: (settingsRow?.lunch_end || process.env.CLINIC_LUNCH_END || '14:00').slice(0, 5),
    weeklyOff: settingsRow?.weekly_off || process.env.CLINIC_WEEKLY_OFF || 'Sunday',
    consultationFee: Number(settingsRow?.consultation_fee ?? process.env.CLINIC_CONSULTATION_FEE ?? 500),
  }

  cachedCredentials = credentials
  cacheExpiresAt = now + CACHE_TTL_MS

  return credentials
}
