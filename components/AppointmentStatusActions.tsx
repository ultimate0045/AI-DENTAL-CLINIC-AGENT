'use client'

import React, { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppointmentStatusType = 'Confirmed' | 'Completed' | 'Cancelled' | 'Not Visited' | string

export function getStatusBadgeConfig(status?: string) {
  const s = (status || '').toLowerCase().trim()
  if (s.startsWith('comp')) {
    return {
      label: 'Completed',
      badgeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
      dotClass: 'bg-blue-500',
    }
  }
  if (s.startsWith('canc')) {
    return {
      label: 'Cancelled',
      badgeClass: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 line-through',
      dotClass: 'bg-red-500',
    }
  }
  if (s.includes('not') || s.includes('no_show') || s.includes('no-show') || s.includes('noshow')) {
    return {
      label: 'Not Visited',
      badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      dotClass: 'bg-amber-500',
    }
  }
  return {
    label: 'Scheduled',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-500',
  }
}

export function AppointmentStatusBadge({ status, className }: { status?: string; className?: string }) {
  const cfg = getStatusBadgeConfig(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold border flex-shrink-0 transition-colors',
        cfg.badgeClass,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dotClass)} />
      <span>{cfg.label}</span>
    </span>
  )
}

interface AppointmentStatusActionsProps {
  appointmentId: string
  currentStatus: AppointmentStatusType
  onStatusChange?: (newStatus: string) => void
  onToast?: (msg: string) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

export default function AppointmentStatusActions({
  appointmentId,
  currentStatus,
  onStatusChange,
  onToast,
  size = 'sm',
  disabled = false,
  className,
}: AppointmentStatusActionsProps) {
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  const handleUpdate = async (newStatus: 'Completed' | 'Cancelled' | 'Not Visited') => {
    if (disabled || updatingStatus) return
    if (currentStatus === newStatus) return

    setUpdatingStatus(newStatus)
    onStatusChange?.(newStatus)

    try {
      const res = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        onToast?.(`Status updated to "${newStatus}" & synced to Google Sheets.`)
      } else {
        const err = data?.error || 'Failed to sync status'
        onToast?.(`Warning: ${err}`)
      }
    } catch (err: any) {
      console.error('Status action error:', err)
      onToast?.('Failed to update status. Please try again.')
    } finally {
      setUpdatingStatus(null)
    }
  }

  const isCompleted = (currentStatus || '').toLowerCase().startsWith('comp')
  const isCancelled = (currentStatus || '').toLowerCase().startsWith('canc')
  const isNotVisited =
    (currentStatus || '').toLowerCase().includes('not') ||
    (currentStatus || '').toLowerCase().includes('no_show')

  return (
    <div className={cn('flex items-center gap-1 sm:gap-1.5 flex-wrap', className)}>
      {/* 1. Completed Button */}
      <button
        type="button"
        disabled={disabled || Boolean(updatingStatus)}
        onClick={() => handleUpdate('Completed')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold transition-all border active:scale-95 cursor-pointer shadow-2xs',
          isCompleted
            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
            : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/25'
        )}
        title="Mark appointment as Completed (Syncs to Google Sheets)"
      >
        {updatingStatus === 'Completed' ? (
          <Loader2 className="w-3 h-3 animate-spin text-current" />
        ) : (
          <CheckCircle2 className="w-3 h-3" />
        )}
        <span>Completed</span>
      </button>

      {/* 2. Cancel Button */}
      <button
        type="button"
        disabled={disabled || Boolean(updatingStatus)}
        onClick={() => handleUpdate('Cancelled')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold transition-all border active:scale-95 cursor-pointer shadow-2xs',
          isCancelled
            ? 'bg-red-600 text-white border-red-600 shadow-sm'
            : 'bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/25'
        )}
        title="Cancel appointment (Frees Google Calendar slot & updates Google Sheets)"
      >
        {updatingStatus === 'Cancelled' ? (
          <Loader2 className="w-3 h-3 animate-spin text-current" />
        ) : (
          <XCircle className="w-3 h-3" />
        )}
        <span>Cancel</span>
      </button>

      {/* 3. Not Visited Button */}
      <button
        type="button"
        disabled={disabled || Boolean(updatingStatus)}
        onClick={() => handleUpdate('Not Visited')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold transition-all border active:scale-95 cursor-pointer shadow-2xs',
          isNotVisited
            ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
            : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/25'
        )}
        title="Mark patient as Not Visited (Syncs to Google Sheets)"
      >
        {updatingStatus === 'Not Visited' ? (
          <Loader2 className="w-3 h-3 animate-spin text-current" />
        ) : (
          <AlertCircle className="w-3 h-3" />
        )}
        <span>Not Visited</span>
      </button>
    </div>
  )
}
