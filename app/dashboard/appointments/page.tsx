'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Calendar,
  Clock,
  User,
  Phone,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  MessageSquare,
  AlertCircle,
  Sparkles,
  ArrowUpDown,
  Filter,
  Check,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { getExactWeekday, formatPhone, getInitials } from '@/lib/utils'
import RescheduleModal from '@/components/appointments/RescheduleModal'
import CancelConfirmModal from '@/components/appointments/CancelConfirmModal'

export interface AppointmentRecord {
  id: string
  booking_id: string
  conversation_id: string | null
  patient_name: string
  patient_phone: string
  dental_issue: string | null
  appointment_date: string // YYYY-MM-DD
  time_slot: string
  status: 'Confirmed' | 'Completed' | 'Cancelled' | 'No-Show'
  google_event_id: string | null
  created_at: string
  updated_at: string
}

type TabType = 'All' | 'Today' | 'Upcoming' | 'Completed' | 'Cancelled'

function getTodayStr(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDentalIssueAndVisitType(rawIssue: string | null): { issue: string; visitType: string } {
  if (!rawIssue) return { issue: 'General Dental Consultation', visitType: 'Regular' }

  let visitType = 'Regular'
  if (rawIssue.toLowerCase().includes('first-time') || rawIssue.toLowerCase().includes('first time') || rawIssue.toLowerCase().includes('pehli baar')) {
    visitType = 'First-time'
  } else if (rawIssue.toLowerCase().includes('returning') || rawIssue.toLowerCase().includes('regular')) {
    visitType = 'Regular'
  }

  // Strip parenthetical visit type from issue string for cleaner display
  const cleaned = rawIssue
    .replace(/\((First-time|Regular|Returning|Pehli Baar)[^)]*\)/gi, '')
    .trim()

  return {
    issue: cleaned || rawIssue,
    visitType,
  }
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Modals state
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentRecord | null>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentRecord | null>(null)

  const todayStr = useMemo(() => getTodayStr(), [])

  const fetchAppointments = async () => {
    try {
      const res = await fetch('/api/appointments')
      if (res.ok) {
        const data = await res.json()
        setAppointments(data.appointments || [])
      }
    } catch (err) {
      console.error('Failed to fetch appointments:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAppointments()
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchAppointments()
  }

  // Handle Mark as Completed
  const handleComplete = async (appt: AppointmentRecord) => {
    setActionLoadingId(appt.id)
    try {
      const res = await fetch(`/api/appointments/${appt.id}/complete`, {
        method: 'PATCH',
      })
      if (res.ok) {
        setAppointments((prev) =>
          prev.map((item) => (item.id === appt.id ? { ...item, status: 'Completed' } : item))
        )
      }
    } catch (err) {
      console.error('Failed to mark appointment completed:', err)
    } finally {
      setActionLoadingId(null)
    }
  }

  // Counts for each tab
  const counts = useMemo(() => {
    let today = 0
    let upcoming = 0
    let completed = 0
    let cancelled = 0

    appointments.forEach((a) => {
      if (a.status === 'Completed') {
        completed++
      } else if (a.status === 'Cancelled') {
        cancelled++
      } else if (a.appointment_date === todayStr) {
        today++
      } else if (a.appointment_date > todayStr) {
        upcoming++
      }
    })

    return {
      all: appointments.length,
      today,
      upcoming,
      completed,
      cancelled,
    }
  }, [appointments, todayStr])

  // Filter appointments by active tab and search query
  const filteredAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      // 1. Tab filter
      if (activeTab === 'Today') {
        if (appt.appointment_date !== todayStr) return false
      } else if (activeTab === 'Upcoming') {
        if (!(appt.appointment_date > todayStr && appt.status === 'Confirmed')) return false
      } else if (activeTab === 'Completed') {
        if (appt.status !== 'Completed') return false
      } else if (activeTab === 'Cancelled') {
        if (appt.status !== 'Cancelled') return false
      }

      // 2. Search query filter (Booking ID, Patient Name, Phone)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchBooking = appt.booking_id.toLowerCase().includes(q)
        const matchName = (appt.patient_name || '').toLowerCase().includes(q)
        const matchPhone = (appt.patient_phone || '').toLowerCase().includes(q)
        const matchIssue = (appt.dental_issue || '').toLowerCase().includes(q)
        if (!matchBooking && !matchName && !matchPhone && !matchIssue) return false
      }

      return true
    })
  }, [appointments, activeTab, searchQuery, todayStr])

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#F8FAFC] dark:bg-[#0B141A] flex flex-col select-none">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5 bg-card border-b border-border">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Appointments Management</h1>
              <p className="text-xs text-muted-foreground">
                Live bookings scheduled via WhatsApp AI bot, synced with Google Calendar & Supabase.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted text-foreground transition-all shadow-sm"
            title="Refresh appointments"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-500' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── Toolbar: Filter Tabs & Search Bar ── */}
      <div className="p-6 pb-2 space-y-4">
        {/* Metric summary pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Today's Appointments</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{counts.today}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Upcoming Bookings</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{counts.upcoming}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <CalendarDays className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Completed Visits</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{counts.completed}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Cancelled</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{counts.cancelled}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center">
              <CalendarX className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Filters and search row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl border border-border/40 overflow-x-auto">
            {(
              [
                { label: 'All', count: counts.all },
                { label: 'Today', count: counts.today },
                { label: 'Upcoming', count: counts.upcoming },
                { label: 'Completed', count: counts.completed },
                { label: 'Cancelled', count: counts.cancelled },
              ] as { label: TabType; count: number }[]
            ).map((tab) => {
              const isActive = activeTab === tab.label
              return (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(tab.label)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-background text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search Box */}
          <div className="relative flex items-center w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Booking ID, patient, phone..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-card border border-border focus:border-emerald-500 focus:outline-none transition-all placeholder:text-muted-foreground shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* ── Table Container ── */}
      <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col">
        <div className="flex-1 bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <p className="text-xs font-medium">Loading appointments schedule...</p>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-muted/80 text-muted-foreground flex items-center justify-center">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">No appointments found</p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  {searchQuery
                    ? `No appointments match "${searchQuery}". Try clearing the search.`
                    : `No ${activeTab.toLowerCase()} appointments scheduled at this moment.`}
                </p>
              </div>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm z-10 border-b border-border/80 text-muted-foreground font-semibold">
                  <tr>
                    <th className="py-3 px-4">Booking ID</th>
                    <th className="py-3 px-4">Patient & Contact</th>
                    <th className="py-3 px-4">Date & Weekday</th>
                    <th className="py-3 px-4">Time Slot</th>
                    <th className="py-3 px-4">Issue & Visit Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50 text-foreground">
                  {filteredAppointments.map((appt) => {
                    const weekday = getExactWeekday(appt.appointment_date)
                    const { issue, visitType } = parseDentalIssueAndVisitType(appt.dental_issue)
                    const isConfirmed = appt.status === 'Confirmed'
                    const isCompleted = appt.status === 'Completed'
                    const isCancelled = appt.status === 'Cancelled'
                    const isActionLoading = actionLoadingId === appt.id

                    return (
                      <tr
                        key={appt.id}
                        className="hover:bg-muted/30 transition-colors group"
                      >
                        {/* 1. Booking ID */}
                        <td className="py-3.5 px-4 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          <span className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                            {appt.booking_id}
                          </span>
                        </td>

                        {/* 2. Patient & Contact */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] flex items-center justify-center flex-shrink-0">
                              {getInitials(appt.patient_name)}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground text-xs leading-tight">
                                {appt.patient_name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-muted-foreground">
                                  {formatPhone(appt.patient_phone)}
                                </span>
                                {appt.conversation_id && (
                                  <Link
                                    href={`/dashboard/chat/${appt.conversation_id}`}
                                    className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                                    title="Open WhatsApp chat"
                                  >
                                    <MessageSquare className="w-2.5 h-2.5" />
                                    <span>Chat</span>
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 3. Date & Weekday */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            <span className="font-semibold text-foreground">
                              {appt.appointment_date}
                            </span>
                            {weekday && (
                              <span className="block text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                {weekday}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 4. Time Slot */}
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 font-semibold text-xs px-2 py-1 rounded-lg bg-muted text-foreground border border-border/60">
                            <Clock className="w-3 h-3 text-emerald-500" />
                            {appt.time_slot}
                          </span>
                        </td>

                        {/* 5. Issue & Visit Type */}
                        <td className="py-3.5 px-4 max-w-[200px]">
                          <p className="truncate font-medium text-xs text-foreground" title={issue}>
                            {issue}
                          </p>
                          <span
                            className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                              visitType === 'First-time'
                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                                : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                            }`}
                          >
                            {visitType}
                          </span>
                        </td>

                        {/* 6. Status Badge */}
                        <td className="py-3.5 px-4">
                          {isConfirmed && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Confirmed
                            </span>
                          )}
                          {isCompleted && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                              <CheckCircle2 className="w-3 h-3 text-blue-500" />
                              Completed
                            </span>
                          )}
                          {isCancelled && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/20">
                              <XCircle className="w-3 h-3 text-red-500" />
                              Cancelled
                            </span>
                          )}
                          {!isConfirmed && !isCompleted && !isCancelled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                              {appt.status}
                            </span>
                          )}
                        </td>

                        {/* 7. Action Buttons */}
                        <td className="py-3.5 px-4 text-right">
                          {isConfirmed ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Complete Button */}
                              <button
                                onClick={() => handleComplete(appt)}
                                disabled={isActionLoading}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition-colors"
                                title="Mark patient appointment as completed"
                              >
                                {isActionLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                <span className="hidden sm:inline">Complete</span>
                              </button>

                              {/* Reschedule Button */}
                              <button
                                onClick={() => setRescheduleTarget(appt)}
                                disabled={isActionLoading}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border hover:bg-muted text-foreground transition-colors shadow-sm"
                                title="Reschedule date or time slot"
                              >
                                <Calendar className="w-3 h-3 text-muted-foreground" />
                                <span className="hidden sm:inline">Reschedule</span>
                              </button>

                              {/* Cancel Button */}
                              <button
                                onClick={() => setCancelTarget(appt)}
                                disabled={isActionLoading}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors shadow-sm"
                                title="Cancel appointment"
                              >
                                <XCircle className="w-3 h-3" />
                                <span className="hidden sm:inline">Cancel</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">
                              {isCompleted ? 'Finished' : 'Cancelled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <RescheduleModal
        isOpen={Boolean(rescheduleTarget)}
        onClose={() => setRescheduleTarget(null)}
        appointment={rescheduleTarget}
        onSuccess={() => fetchAppointments()}
      />

      <CancelConfirmModal
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        appointment={cancelTarget}
        onSuccess={() => fetchAppointments()}
      />
    </div>
  )
}
