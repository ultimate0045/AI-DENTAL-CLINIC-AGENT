'use client'

import React, { useState, useEffect } from 'react'
import {
  Calendar,
  Clock,
  User,
  Phone,
  AlertCircle,
  Loader2,
  CheckCircle2,
  X,
  ArrowRight,
} from 'lucide-react'
import { getExactWeekday, formatPhone } from '@/lib/utils'

interface RescheduleModalProps {
  isOpen: boolean
  onClose: () => void
  appointment: any | null
  onSuccess: () => void
}

const DEFAULT_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
]

export default function RescheduleModal({
  isOpen,
  onClose,
  appointment,
  onSuccess,
}: RescheduleModalProps) {
  const [newDate, setNewDate] = useState('')
  const [newSlot, setNewSlot] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    if (appointment) {
      setNewDate(appointment.appointment_date || '')
      setNewSlot(appointment.time_slot || '')
      setError(null)
      setSuccessMsg(null)
    }
  }, [appointment])

  if (!isOpen || !appointment) return null

  const weekday = newDate ? getExactWeekday(newDate) : ''
  const todayStr = new Date().toISOString().slice(0, 10)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDate || !newSlot) {
      setError('Please select both a new appointment date and a time slot.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/appointments/${appointment.id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_date: newDate,
          time_slot: newSlot,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to reschedule appointment')
        return
      }

      setSuccessMsg(`Rescheduled to ${newDate} (${weekday}) at ${newSlot}!`)
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1000)
    } catch (err: any) {
      setError(err?.message || 'Network error occurred while rescheduling')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Reschedule Appointment</h3>
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

        {/* Current appointment summary */}
        <div className="p-4 bg-muted/20 border-b border-border/60 text-xs space-y-1.5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              {appointment.patient_name}
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              <Phone className="w-3 h-3 text-muted-foreground" />
              {formatPhone(appointment.patient_phone)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground pt-1">
            <span className="font-medium text-foreground">Current:</span>
            <span>
              {appointment.appointment_date} ({getExactWeekday(appointment.appointment_date)}) at {appointment.time_slot}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* New Date Picker */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground">
              New Appointment Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={newDate}
              min={todayStr}
              onChange={(e) => setNewDate(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs rounded-xl bg-muted/50 border border-border focus:border-emerald-500 focus:bg-background focus:outline-none transition-all"
            />
            {weekday && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                📅 Day: {weekday}
              </p>
            )}
          </div>

          {/* New Time Slot Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground">
              New Time Slot <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto p-1 border border-border/60 rounded-xl bg-muted/20">
              {DEFAULT_SLOTS.map((slot) => {
                const isSelected = newSlot === slot
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setNewSlot(slot)}
                    className={`py-1.5 px-2 text-[11px] font-medium rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-background hover:bg-muted text-foreground border-border/60'
                    }`}
                  >
                    {slot}
                  </button>
                )
              })}
            </div>
            {newSlot && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3 text-emerald-500" />
                Selected Slot: <strong className="text-foreground">{newSlot}</strong>
              </p>
            )}
          </div>

          {/* WhatsApp & Google Calendar notification notice */}
          <div className="p-2.5 rounded-xl bg-muted/50 border border-border/50 text-[11px] text-muted-foreground flex items-center gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <span>
              Rescheduling updates Google Calendar and dispatches an updated WhatsApp confirmation to the patient.
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !newDate || !newSlot}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Rescheduling...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Confirm Reschedule</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
