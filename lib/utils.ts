import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(date: string | Date): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return String(date)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function formatDate(date: string | Date): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

export function getExactWeekday(dateStr?: string): string {
  if (!dateStr) return ''
  const parts = String(dateStr).split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return ''
  const [year, month, day] = parts
  return new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString('en-US', { weekday: 'long' })
}

export function formatRelativeTime(date: string | Date): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function generateBookingId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `APPT-${dateStr}-${randomStr}`
}

export function truncateText(text: string, maxLength: number): string {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

export function getInitials(name: string): string {
  if (!name) return '?'
  const clean = name.trim()
  if (!clean) return '?'
  return clean
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function formatPhone(phone: string): string {
  if (!phone) return ''
  // E.g. +919876543210 -> +91 98765 43210
  const clean = phone.replace(/\s+/g, '')
  if (clean.length === 13 && clean.startsWith('+')) {
    return `${clean.slice(0, 3)} ${clean.slice(3, 8)} ${clean.slice(8)}`
  }
  return clean
}

export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)
}

export function stripEmojis(text?: string): string {
  if (!text) return ''
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function generateTimeSlots(start: string, end: string, intervalMins: number = 30): string[] {
  const slots: string[] = []
  if (!isValidTime(start) || !isValidTime(end)) return slots

  const [startHour, startMin] = start.split(':').map(Number)
  const [endHour, endMin] = end.split(':').map(Number)

  let currentTotalMin = startHour * 60 + startMin
  const endTotalMin = endHour * 60 + endMin

  while (currentTotalMin + intervalMins <= endTotalMin) {
    const h = Math.floor(currentTotalMin / 60)
    const m = currentTotalMin % 60
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    slots.push(timeStr)
    currentTotalMin += intervalMins
  }

  return slots
}

export function parseGooglePrivateKey(key?: string): string {
  if (!key) return ''
  let clean = key.trim()

  // Strip wrapping quotes if any (e.g. from env string parsing)
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1)
  }

  // Handle both double-escaped \\n and escaped \n
  clean = clean.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()

  // Extract standard PEM header and footer
  const headerMatch = clean.match(/-----BEGIN [A-Z0-9 ]+-----/)
  const footerMatch = clean.match(/-----END [A-Z0-9 ]+-----/)

  if (headerMatch && footerMatch) {
    const header = headerMatch[0]
    const footer = footerMatch[0]

    const startIndex = clean.indexOf(header) + header.length
    const endIndex = clean.indexOf(footer)
    const base64Body = clean.substring(startIndex, endIndex).replace(/\s+/g, '')

    // OpenSSL requires base64 payload to be broken into standard 64-character lines
    const lines = base64Body.match(/.{1,64}/g) || []
    return `${header}\n${lines.join('\n')}\n${footer}\n`
  }

  return clean
}

const MONTH_NAMES: Record<string, { month: number; name: string }> = {
  jan: { month: 1, name: 'January' }, january: { month: 1, name: 'January' },
  feb: { month: 2, name: 'February' }, february: { month: 2, name: 'February' }, februrary: { month: 2, name: 'February' },
  mar: { month: 3, name: 'March' }, march: { month: 3, name: 'March' },
  apr: { month: 4, name: 'April' }, april: { month: 4, name: 'April' },
  may: { month: 5, name: 'May' },
  jun: { month: 6, name: 'June' }, june: { month: 6, name: 'June' },
  jul: { month: 7, name: 'July' }, july: { month: 7, name: 'July' },
  aug: { month: 8, name: 'August' }, august: { month: 8, name: 'August' },
  sep: { month: 9, name: 'September' }, sept: { month: 9, name: 'September' }, september: { month: 9, name: 'September' },
  oct: { month: 10, name: 'October' }, october: { month: 10, name: 'October' },
  nov: { month: 11, name: 'November' }, novmber: { month: 11, name: 'November' }, november: { month: 11, name: 'November' },
  dec: { month: 12, name: 'December' }, decembr: { month: 12, name: 'December' }, december: { month: 12, name: 'December' },
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export interface DateValidationResult {
  valid: boolean
  date?: string
  error?: string
  errorType?: 'invalid_day_in_month' | 'past_date' | 'invalid_format' | 'phone_number'
  maxDays?: number
  monthName?: string
  message_en?: string
  message_hi?: string
}

export function resolveAndValidateDate(input?: string): DateValidationResult {
  if (!input) return { valid: false, errorType: 'invalid_format', error: 'No date provided' }
  const str = String(input).trim().toLowerCase()

  // Reject phone numbers passed as dates, but never reject formatted dates (YYYY-MM-DD, DD/MM/YYYY)
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(str) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(str)) {
    const cleanDigits = str.replace(/[\s()+]/g, '')
    if (/^[6-9]\d{9}$/.test(cleanDigits) || (/^(91)?\d{10}$/.test(cleanDigits) && !str.includes('-') && !str.includes('/'))) {
      return { valid: false, errorType: 'phone_number', error: 'Input is a phone number, not a date' }
    }
  }

  const now = new Date()
  const timeZone = 'Asia/Kolkata'
  const todayStr = now.toLocaleDateString('en-CA', { timeZone })
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone })
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Relative dates
  if (['today', '2day', 'tday', 'aaj', 'aj'].includes(str)) {
    return { valid: true, date: todayStr }
  }
  if (['tomorrow', 'tomorow', 'tommorrow', 'tomrw', 'tmrw', 'tmr', 'kal', 'kl'].includes(str)) {
    return { valid: true, date: tomorrowStr }
  }
  if (['day after tomorrow', 'day after tomorow', 'day after tmrw', 'parso', 'parson'].includes(str)) {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    return { valid: true, date: d.toLocaleDateString('en-CA', { timeZone }) }
  }

  // Weekdays
  const weekdays: Record<string, number> = {
    sunday: 0, sun: 0, itwar: 0, ravivar: 0,
    monday: 1, mon: 1, somwar: 1,
    tuesday: 2, tue: 2, mangalwar: 2,
    wednesday: 3, wed: 3, budhwar: 3,
    thursday: 4, thu: 4, guruwar: 4, brihaspatiwar: 4,
    friday: 5, fri: 5, shukrawar: 5,
    saturday: 6, sat: 6, shaniwar: 6,
  }
  const cleanWeekday = str.replace(/^(this|next|coming)\s+/, '').trim()
  if (weekdays[cleanWeekday] !== undefined) {
    const targetDay = weekdays[cleanWeekday]
    const currentDay = now.getDay()
    let diff = targetDay - currentDay
    if (diff <= 0) diff += 7
    const targetDate = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000)
    return { valid: true, date: targetDate.toLocaleDateString('en-CA', { timeZone }) }
  }

  // Explicit YYYY-MM-DD
  const yyyymmdd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (yyyymmdd) {
    const y = parseInt(yyyymmdd[1], 10)
    const m = parseInt(yyyymmdd[2], 10)
    const d = parseInt(yyyymmdd[3], 10)
    const maxDays = getDaysInMonth(y, m)
    if (d > maxDays) {
      const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      const mName = monthNames[m] || `Month ${m}`
      return {
        valid: false,
        errorType: 'invalid_day_in_month',
        maxDays,
        monthName: mName,
        message_en: `${mName} only has ${maxDays} days. Could you please share a valid upcoming date? 📅`,
        message_hi: `${mName} mein sirf ${maxDays} din hote hain. Please koi valid aane wali date batayein? 📅`,
      }
    }
    const resolved = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (resolved < todayStr) {
      return {
        valid: false,
        errorType: 'past_date',
        message_en: `That date has already passed. Could you please share an upcoming date? 📅`,
        message_hi: `Yeh date nikal chuki hai. Please aane wali koi date batayein? 📅`,
      }
    }
    return { valid: true, date: resolved }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (ddmmyyyy) {
    const d = parseInt(ddmmyyyy[1], 10)
    const m = parseInt(ddmmyyyy[2], 10)
    const y = parseInt(ddmmyyyy[3], 10)
    const maxDays = getDaysInMonth(y, m)
    if (d > maxDays) {
      const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      const mName = monthNames[m] || `Month ${m}`
      return {
        valid: false,
        errorType: 'invalid_day_in_month',
        maxDays,
        monthName: mName,
        message_en: `${mName} only has ${maxDays} days. Could you please share a valid upcoming date? 📅`,
        message_hi: `${mName} mein sirf ${maxDays} din hote hain. Please koi valid aane wali date batayein? 📅`,
      }
    }
    const resolved = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (resolved < todayStr) {
      return {
        valid: false,
        errorType: 'past_date',
        message_en: `That date has already passed. Could you please share an upcoming date? 📅`,
        message_hi: `Yeh date nikal chuki hai. Please aane wali koi date batayein? 📅`,
      }
    }
    return { valid: true, date: resolved }
  }

  // Match e.g. "15th Nov", "31st November", "15 November 2026"
  const match1 = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/)
  if (match1) {
    const day = parseInt(match1[1], 10)
    const monthKey = match1[2].slice(0, 3)
    const monthObj = MONTH_NAMES[monthKey] || MONTH_NAMES[match1[2]]
    const year = match1[3] ? parseInt(match1[3], 10) : currentYear
    if (monthObj) {
      const maxDays = getDaysInMonth(year, monthObj.month)
      if (day > maxDays) {
        return {
          valid: false,
          errorType: 'invalid_day_in_month',
          maxDays,
          monthName: monthObj.name,
          message_en: `${monthObj.name} only has ${maxDays} days. Could you please share a valid upcoming date? 📅`,
          message_hi: `${monthObj.name} mein sirf ${maxDays} din hote hain. Please koi valid aane wali date batayein? 📅`,
        }
      }
      const resolved = `${year}-${String(monthObj.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (resolved < todayStr) {
        return {
          valid: false,
          errorType: 'past_date',
          message_en: `That date has already passed. Could you please share an upcoming date? 📅`,
          message_hi: `Yeh date nikal chuki hai. Please aane wali koi date batayein? 📅`,
        }
      }
      return { valid: true, date: resolved }
    }
  }

  // Match e.g. "Nov 15", "November 31st"
  const match2 = str.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/)
  if (match2) {
    const monthKey = match2[1].slice(0, 3)
    const monthObj = MONTH_NAMES[monthKey] || MONTH_NAMES[match2[1]]
    const day = parseInt(match2[2], 10)
    const year = match2[3] ? parseInt(match2[3], 10) : currentYear
    if (monthObj) {
      const maxDays = getDaysInMonth(year, monthObj.month)
      if (day > maxDays) {
        return {
          valid: false,
          errorType: 'invalid_day_in_month',
          maxDays,
          monthName: monthObj.name,
          message_en: `${monthObj.name} only has ${maxDays} days. Could you please share a valid upcoming date? 📅`,
          message_hi: `${monthObj.name} mein sirf ${maxDays} din hote hain. Please koi valid aane wali date batayein? 📅`,
        }
      }
      const resolved = `${year}-${String(monthObj.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (resolved < todayStr) {
        return {
          valid: false,
          errorType: 'past_date',
          message_en: `That date has already passed. Could you please share an upcoming date? 📅`,
          message_hi: `Yeh date nikal chuki hai. Please aane wali koi date batayein? 📅`,
        }
      }
      return { valid: true, date: resolved }
    }
  }

  // Fallback to standalone day number (e.g. "17th", "17", "31st")
  const matchDayOnly = str.match(/^(\d{1,2})(?:st|nd|rd|th)?$/)
  if (matchDayOnly) {
    const day = parseInt(matchDayOnly[1], 10)
    const maxDays = getDaysInMonth(currentYear, currentMonth)
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const mName = monthNames[currentMonth] || `Month ${currentMonth}`
    if (day > maxDays) {
      return {
        valid: false,
        errorType: 'invalid_day_in_month',
        maxDays,
        monthName: mName,
        message_en: `${mName} only has ${maxDays} days. Could you please share a valid upcoming date? 📅`,
        message_hi: `${mName} mein sirf ${maxDays} din hote hain. Please koi valid aane wali date batayein? 📅`,
      }
    }
    const resolved = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (resolved < todayStr) {
      return {
        valid: false,
        errorType: 'past_date',
        message_en: `That date has already passed. Could you please share an upcoming date? 📅`,
        message_hi: `Yeh date nikal chuki hai. Please aane wali koi date batayein? 📅`,
      }
    }
    return { valid: true, date: resolved }
  }

  return { valid: false, errorType: 'invalid_format', error: `Unrecognized date format: ${input}` }
}

export function normalizeDate(input?: string): string {
  const result = resolveAndValidateDate(input)
  if (result.valid && result.date) {
    return result.date
  }
  return input || ''
}
