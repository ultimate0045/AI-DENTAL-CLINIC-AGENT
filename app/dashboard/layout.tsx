'use client'

import React, { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [clinicName, setClinicName] = useState('Dental Clinic')

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.settings?.clinicName) {
          setClinicName(data.settings.clinicName)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top Integration Status Bar */}
      <StatusBar />

      {/* Main Workspace: Sidebar + Chat/Settings Content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar clinicName={clinicName} />
        <main className="flex-1 overflow-hidden flex flex-col relative">
          {children}
        </main>
      </div>
    </div>
  )
}
