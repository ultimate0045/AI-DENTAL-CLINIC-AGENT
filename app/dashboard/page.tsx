'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Bot,
  Calendar,
  Settings,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  Stethoscope,
  Clock,
  User,
  CalendarCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import SimulateModal from '@/components/SimulateModal'
import { getExactWeekday, formatPhone } from '@/lib/utils'

interface AppointmentItem {
  id: string
  booking_id: string
  patient_name: string
  patient_phone: string
  dental_issue: string | null
  appointment_date: string
  time_slot: string
  status: string
  conversation_id: string | null
}

export default function DashboardPage() {
  const [settings, setSettings] = useState<any>(null)
  const [isSimulateOpen, setIsSimulateOpen] = useState(false)
  const [conversationsCount, setConversationsCount] = useState(0)
  const [recentAppointments, setRecentAppointments] = useState<AppointmentItem[]>([])
  const [loadingAppts, setLoadingAppts] = useState(true)

  const loadData = () => {
    // 1. Settings
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.settings) setSettings(data.settings)
      })
      .catch(() => {})

    // 2. Conversations count
    fetch('/api/conversations')
      .then((res) => res.json())
      .then((data) => {
        if (data?.conversations) {
          setConversationsCount(data.conversations.length)
        }
      })
      .catch(() => {})

    // 3. Compact upcoming appointments (next 5 confirmed)
    fetch('/api/appointments?limit=5&status=Confirmed')
      .then((res) => res.json())
      .then((data) => {
        if (data?.appointments) {
          setRecentAppointments(data.appointments)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAppts(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const calendarWebUrl =
    settings?.googleCalendarId && settings.googleCalendarId.includes('@')
      ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(settings.googleCalendarId)}`
      : 'https://calendar.google.com/calendar/r'

  return (
    <div className="flex-1 h-full w-full overflow-y-auto overflow-x-hidden bg-[#F8FAFC] dark:bg-[#0B141A] flex flex-col items-center justify-start p-3.5 sm:p-6 md:p-8 select-none">
      <div className="max-w-3xl w-full space-y-4 sm:space-y-6">
        {/* ── Top Clinic Header ── */}
        <div className="text-center space-y-2.5 sm:space-y-3">
          <div className="relative inline-block mx-auto">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-inner border border-emerald-500/20">
              <Stethoscope className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-500" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow">
              <Bot className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>

          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-foreground tracking-tight px-2">
              {settings?.clinicName ? `${settings.clinicName} — AI Control Panel` : 'WhatsApp AI Dental Receptionist'}
            </h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground max-w-md mx-auto mt-1 leading-relaxed px-2">
              Your 24/7 autonomous receptionist handling patient inquiries, checking dental timings, and booking appointments into Google Calendar.
            </p>
          </div>

          {/* 2 Clean Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 pt-1">
            <Button
              onClick={() => setIsSimulateOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm rounded-xl px-3.5 sm:px-4 py-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Test Bot (Simulate)</span>
            </Button>

            <Link href="/dashboard/settings">
              <Button variant="outline" className="text-xs gap-1.5 border-border shadow-sm rounded-xl px-3.5 sm:px-4 py-2">
                <Settings className="w-3.5 h-3.5" />
                <span>Clinic Settings</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* ── 3 Simple Status / Overview Cards ── */}
        <div className="space-y-4">
          {/* Top Row: 2 Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {/* Card 1: WhatsApp Bot Status */}
            <Card className="bg-card border-border/80 shadow-sm hover:shadow-md transition-shadow rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2 text-foreground">
                    <MessageSquare className="w-4 h-4 text-emerald-500" />
                    WhatsApp Bot Status
                  </CardTitle>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-1 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  {conversationsCount} Active Patient Conversation{conversationsCount === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] leading-relaxed">
                  Meta WhatsApp Cloud API connected. Select any chat from the sidebar to inspect or take over as human receptionist.
                </p>
              </CardContent>
            </Card>

            {/* Card 2: Google Calendar & Sheets Sync Status */}
            <Card className="bg-card border-border/80 shadow-sm hover:shadow-md transition-shadow rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2 text-foreground">
                    <Calendar className="w-4 h-4 text-emerald-500" />
                    Calendar & Sheets Sync
                  </CardTitle>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Synced
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-1 text-xs text-muted-foreground space-y-2">
                <p className="text-[11px] leading-relaxed">
                  Live availability checks against Google Calendar & automated booking logs synced to Google Sheets.
                </p>
                <a
                  href={calendarWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                >
                  <span>Open Google Calendar</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </CardContent>
            </Card>
          </div>

          {/* Card 3: Today's / Upcoming Appointments (Compact Read-Only List) */}
          <Card className="bg-card border-border/80 shadow-sm rounded-2xl text-left overflow-hidden">
            <CardHeader className="p-4 pb-3 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="w-4 h-4 text-emerald-500" />
                  <CardTitle className="text-xs font-semibold text-foreground">
                    Upcoming Appointments
                  </CardTitle>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    Next {recentAppointments.length} Bookings
                  </span>
                </div>

                <a
                  href={calendarWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors font-medium"
                  title="View full schedule on Google Calendar"
                >
                  <span>View in Calendar</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardHeader>

            <CardContent className="p-0 divide-y divide-border/50">
              {loadingAppts ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Loading upcoming bookings...
                </div>
              ) : recentAppointments.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No upcoming appointments scheduled yet.
                </div>
              ) : (
                recentAppointments.map((appt) => {
                  const weekday = getExactWeekday(appt.appointment_date)
                  const cleanIssue = (appt.dental_issue || 'Dental Consultation')
                    .replace(/\((First-time|Regular|Returning)[^)]*\)/gi, '')
                    .trim()

                  return (
                    <div
                      key={appt.id}
                      className="p-3 sm:p-3.5 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-3 hover:bg-muted/30 transition-colors"
                    >
                      {/* Left: Patient info + issue */}
                      <div className="min-w-0 flex items-center gap-2.5 sm:gap-3">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-foreground truncate max-w-[90px] sm:max-w-none">
                              {appt.patient_name}
                            </span>
                            <span className="text-[9px] sm:text-[10px] font-mono text-muted-foreground px-1.5 py-0.2 rounded bg-muted flex-shrink-0">
                              {appt.booking_id}
                            </span>
                          </div>
                          <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate mt-0.5 max-w-[130px] sm:max-w-none">
                            {cleanIssue}
                          </p>
                        </div>
                      </div>

                      {/* Right: Date, Time & Chat link */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 text-right">
                        <div>
                          <div className="flex items-center gap-1 justify-end font-semibold text-xs text-foreground">
                            <Clock className="w-3 h-3 text-emerald-500" />
                            <span>{appt.time_slot}</span>
                          </div>
                          <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                            {appt.appointment_date}{weekday ? ` (${weekday.slice(0, 3)})` : ''}
                          </p>
                        </div>

                        {appt.conversation_id && (
                          <Link
                            href={`/dashboard/chat/${appt.conversation_id}`}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                            title="Open patient WhatsApp chat"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer Note */}
        <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Zero-code white-label architecture — duplicate for any dental clinic client instantly.</span>
        </div>
      </div>

      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onSuccess={() => loadData()}
      />
    </div>
  )
}
