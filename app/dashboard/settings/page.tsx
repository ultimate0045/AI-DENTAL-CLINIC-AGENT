'use client'

import React, { useState, useEffect } from 'react'
import SettingsForm from '@/components/SettingsForm'
import { ClinicSettings } from '@/types/index'
import { Loader2 } from 'lucide-react'

export default function SettingsPage() {
  const [settings, setSettings] = useState<ClinicSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        if (data.settings) {
          setSettings(data.settings)
        }
      }
    } catch (err) {
      console.error('Failed to load clinic settings:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSave = async (updated: ClinicSettings) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Failed to save settings')
    }

    const data = await res.json()
    if (data.data) {
      setSettings(updated)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <span className="text-sm font-medium">Loading clinic settings & integrations...</span>
      </div>
    )
  }

  const initialSettings: ClinicSettings = settings || {
    clinicName: 'My Dental Clinic',
    doctorName: 'Dr. Smith',
    address: '123 Main St',
    phone: '+91 98765 43210',
    timingsStart: '09:00',
    timingsEnd: '18:00',
    lunchStart: '13:00',
    lunchEnd: '14:00',
    weeklyOff: 'Sunday',
    slotDurationMinutes: 30,
    consultationFee: 500,
    googleSheetId: '',
    googleCalendarId: '',
    aiMode: 'ai',
    welcomeMessage: 'Welcome to our dental clinic! How can I assist you today?',
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-background">
      <div className="max-w-5xl mx-auto">
        <SettingsForm initialSettings={initialSettings} onSave={handleSave} />
      </div>
    </div>
  )
}
