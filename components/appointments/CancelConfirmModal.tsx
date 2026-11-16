'use client'

import React, { useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  X,
  Phone,
  Calendar,
  Clock,
  User,
} from 'lucide-react'
import { getExactWeekday, formatPhone } from '@/lib/utils'

interface CancelConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  appointment: any | null
  onSuccess: () => void
}

export default function CancelConfirmModal({
  isOpen,
  onClose,
  appointment,
  onSuccess,
}: CancelConfirmModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen || !appointment) return null

  const weekday = getExactWeekday(appointment.appointment_date)

  const handleConfirm = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/appointments/${appointment.id}/cancel`, {
        method: 'PATCH',
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to cancel appointment')
        return
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Network error occurred while cancelling')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-red-500/10 dark:bg-red-950/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Cancel Appointment</h3>
              <p className="text-[11px] text-muted-foreground">Booking ID: {appointment.booking_id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to cancel the following appointment?
          </p>

          {/* Details card */}
          <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                {appointment.patient_name}
              </span>
              <span className="text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3 text-muted-foreground" />
                {formatPhone(appointment.patient_phone)}
              </span>
            </div>

            <div className="flex items-center gap-4 text-muted-foreground pt-1 border-t border-border/40 text-[11px]">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                {appointment.appointment_date} ({weekday})
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-500" />
                {appointment.time_slot}
              </span>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">What happens next:</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              <li>Status will be marked as <strong>Cancelled</strong>.</li>
              <li>Google Calendar event is deleted to free the slot.</li>
              <li>A WhatsApp cancellation notice is dispatched to the patient.</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted text-foreground transition-colors"
            >
              Keep Appointment
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Cancelling...</span>
                </>
              ) : (
                <span>Confirm Cancellation</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
