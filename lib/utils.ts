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
