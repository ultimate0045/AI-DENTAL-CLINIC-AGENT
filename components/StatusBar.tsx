'use client'

import React, { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle, RefreshCw, AlertCircle } from 'lucide-react'

interface ConnectionStatuses {
  meta: boolean
  calendar: boolean
  sheets: boolean
}

export function StatusBar() {
  const [statuses, setStatuses] = useState<ConnectionStatuses>({
    meta: false,
    calendar: false,
    sheets: false,
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [lastChecked, setLastChecked] = useState<string>('')

  const fetchStatus = async () => {
    setLoading(true)
    try {
      const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
      const res = await fetch(`${serverUrl}/api/status`).catch(() => null)
      if (res && res.ok) {
        const data = await res.json()
        setStatuses({
          meta: Boolean(data?.meta),
          calendar: Boolean(data?.calendar),
          sheets: Boolean(data?.sheets),
        })
      } else {
        // Fallback: check Google Sheets from Next.js route
        const sheetRes = await fetch('/api/sheets/status').catch(() => null)
        const sheetData = sheetRes ? await sheetRes.json() : null
        setStatuses({
          meta: false,
          calendar: false,
          sheets: Boolean(sheetData?.connected),
        })
      }
      setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch {
      // offline / mock status
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-card/60 backdrop-blur-sm text-xs select-none">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-wide uppercase text-[10px] text-muted-foreground">
          System Integrations
        </span>

        {/* Meta WhatsApp Cloud API */}
        <div className="flex items-center gap-1.5" title="Meta WhatsApp Cloud API Webhook & Messaging">
          {statuses.meta ? (
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : (
            <span className="flex h-2 w-2 rounded-full bg-amber-500" />
          )}
          <span className="text-muted-foreground">Meta WhatsApp:</span>
          <span className={`font-medium ${statuses.meta ? 'text-emerald-500' : 'text-amber-500'}`}>
            {statuses.meta ? 'Connected' : 'Standby'}
          </span>
        </div>

        <span className="text-border">|</span>

        {/* Google Calendar */}
        <div className="flex items-center gap-1.5" title="Google Calendar Service Account (Appointment Booking)">
          {statuses.calendar ? (
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : (
            <span className="flex h-2 w-2 rounded-full bg-amber-500" />
          )}
          <span className="text-muted-foreground">Google Calendar:</span>
          <span className={`font-medium ${statuses.calendar ? 'text-emerald-500' : 'text-amber-500'}`}>
            {statuses.calendar ? 'Synced' : 'Configured'}
          </span>
        </div>

        <span className="text-border">|</span>

        {/* Google Sheets */}
        <div className="flex items-center gap-1.5" title="Google Sheets Client Database Sync (Appointments & Leads)">
          {statuses.sheets ? (
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : (
            <span className="flex h-2 w-2 rounded-full bg-amber-500" />
          )}
          <span className="text-muted-foreground">Google Sheets:</span>
          <span className={`font-medium ${statuses.sheets ? 'text-emerald-500' : 'text-amber-500'}`}>
            {statuses.sheets ? 'Synced' : 'Configured'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground">
        {lastChecked && <span>Updated {lastChecked}</span>}
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="p-1 hover:text-foreground transition-colors rounded hover:bg-muted"
          title="Refresh connection status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}
