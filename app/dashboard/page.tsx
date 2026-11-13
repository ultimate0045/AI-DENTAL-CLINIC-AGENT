'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Bot,
  Calendar,
  FileSpreadsheet,
  Settings,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Stethoscope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import SimulateModal from '@/components/SimulateModal'

export default function DashboardPage() {
  const [settings, setSettings] = useState<any>(null)
  const [isSimulateOpen, setIsSimulateOpen] = useState(false)
  const [stats, setStats] = useState({
    conversationsCount: 0,
    appointmentsCount: 0,
  })

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.settings) setSettings(data.settings)
      })
      .catch(() => {})

    fetch('/api/conversations')
      .then((res) => res.json())
      .then((data) => {
        if (data?.conversations) {
          setStats((prev) => ({ ...prev, conversationsCount: data.conversations.length }))
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#F0F2F5] dark:bg-[#111B21] flex flex-col items-center justify-center p-6 select-none">
      <div className="max-w-2xl w-full text-center space-y-6">
        {/* Dental / WhatsApp Icon */}
        <div className="relative inline-block mx-auto">
          <div className="w-20 h-20 rounded-3xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-inner border border-emerald-500/20">
            <Stethoscope className="w-10 h-10 text-emerald-500" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow">
            <Bot className="w-4 h-4" />
          </div>
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {settings?.clinicName ? `${settings.clinicName} — AI Receptionist` : 'WhatsApp AI Dental Receptionist'}
          </h1>
          <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Select a conversation from the left sidebar to inspect real-time patient chats, switch between AI auto-reply and human receptionist mode, or manage clinic settings.
          </p>
        </div>

        {/* Core Integration Summary Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {/* Card 1: WhatsApp Cloud */}
          <Card className="bg-card/70 border-border/60 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-3.5 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  WhatsApp Live
                </CardTitle>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </CardHeader>
            <CardContent className="p-3.5 pt-0 text-[11px] text-muted-foreground">
              {stats.conversationsCount} active patient chat{stats.conversationsCount === 1 ? '' : 's'} logged in Supabase.
            </CardContent>
          </Card>

          {/* Card 2: Google Calendar */}
          <Card className="bg-card/70 border-border/60 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-3.5 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-500" />
                  Google Calendar
                </CardTitle>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent className="p-3.5 pt-0 text-[11px] text-muted-foreground">
              Real-time slot checking & automated appointment booking via Gemini function calling.
            </CardContent>
          </Card>

          {/* Card 3: Google Sheets Primary Store */}
          <Card className="bg-card/70 border-border/60 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-3.5 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  Client Google Sheet
                </CardTitle>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent className="p-3.5 pt-0 text-[11px] text-muted-foreground">
              Auto-syncs <code className="text-emerald-500">Appointments</code> and <code className="text-emerald-500">Patients_Leads</code> tabs.
            </CardContent>
          </Card>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button
            onClick={() => setIsSimulateOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Simulate Patient Message
          </Button>

          <Link href="/dashboard/settings">
            <Button variant="outline" className="text-xs gap-1.5 border-border shadow-sm">
              <Settings className="w-3.5 h-3.5" />
              Configure Clinic Settings & Sheet
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>

        {/* Footer Note */}
        <div className="pt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Zero-code white-label architecture — duplicate for any dental clinic client instantly.</span>
        </div>
      </div>

      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onSuccess={() => {
          fetch('/api/conversations')
            .then((res) => res.json())
            .then((data) => {
              if (data?.conversations) {
                setStats((prev) => ({ ...prev, conversationsCount: data.conversations.length }))
              }
            })
            .catch(() => {})
        }}
      />
    </div>
  )
}
