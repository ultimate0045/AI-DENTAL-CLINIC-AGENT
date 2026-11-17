'use client'

import React, { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { supabase } from '@/lib/supabase'
import SimulateModal from '@/components/SimulateModal'
import {
  MessageSquare,
  CalendarCheck,
  Settings,
  Sparkles,
  LogOut,
  Stethoscope,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [clinicName, setClinicName] = useState('Dental Clinic')
  const [mobileTab, setMobileTab] = useState<'chats' | 'overview'>('chats')
  const [isSimulateOpen, setIsSimulateOpen] = useState(false)

  // 1. Strict Authentication Guard (bypasses removed)
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login')
      } else if (mounted) {
        setCheckingAuth(false)
      }
    }).catch(() => {
      router.replace('/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login')
      } else if (mounted) {
        setCheckingAuth(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [router])

  // 2. Fetch Clinic Name
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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // Loading state while verifying authentication
  if (checkingAuth) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#EFEAE2] dark:bg-[#0B141A]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
            <Stethoscope className="w-6 h-6 text-emerald-500 animate-pulse" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            <span>Verifying receptionist credentials...</span>
          </div>
        </div>
      </div>
    )
  }

  const isChatView = pathname.startsWith('/dashboard/chat/')
  const isSettingsView = pathname.startsWith('/dashboard/settings')
  const isDashboardHome = pathname === '/dashboard'

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      {/* Top Integration Status Bar (hidden on mobile chat view to maximize conversation height) */}
      <StatusBar className={isChatView ? 'hidden md:flex' : 'flex'} />

      {/* Main Workspace: Classic WhatsApp Web Two-Pane Split Layout on Desktop
          - Desktop (md: and above): Persistent Left Sidebar (w-[340px] or lg:w-[380px]) + Right Main Pane (flex-1)
          - Mobile (< md): Single-pane toggle between Chats, Active Chat, and Settings
      */}
      <div className="flex flex-row flex-1 overflow-hidden relative">
        {/* Left Sidebar Pane:
            - Desktop (>= 768px): Always visible side-by-side with width 340px-380px
            - Mobile (< 768px): Full-screen when on /dashboard with 'chats' tab, hidden when viewing single chat or settings
        */}
        <Sidebar
          clinicName={clinicName}
          className={cn(
            // Mobile visibility
            isChatView || isSettingsView
              ? 'hidden'
              : mobileTab === 'chats'
              ? 'flex w-full'
              : 'hidden',
            // Desktop visibility: ALWAYS visible side-by-side
            'md:flex md:w-[340px] lg:w-[380px] md:flex-shrink-0'
          )}
        />

        {/* Right Main Pane:
            - Desktop (>= 768px): Always visible side-by-side (flex-1 min-w-0)
            - Mobile (< 768px): Full-screen when on active chat, settings, or dashboard 'overview' tab
        */}
        <main
          className={cn(
            'overflow-hidden flex flex-col relative',
            // Mobile visibility
            isChatView || isSettingsView
              ? 'flex w-full h-full'
              : mobileTab === 'overview'
              ? 'flex w-full h-full'
              : 'hidden',
            // Desktop visibility: ALWAYS visible side-by-side
            'md:flex md:flex-1 md:min-w-0 md:h-full'
          )}
        >
          {/* Mobile-Only Top Tab Switcher on /dashboard Home */}
          {isDashboardHome && (
            <div className="md:hidden flex items-center justify-center p-2.5 bg-card border-b border-border">
              <div className="grid grid-cols-2 p-1 bg-muted rounded-xl w-full max-w-xs text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMobileTab('chats')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg transition-all cursor-pointer',
                    mobileTab === 'chats'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Chats & Inbox</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobileTab('overview')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg transition-all cursor-pointer',
                    mobileTab === 'overview'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <CalendarCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Overview</span>
                </button>
              </div>
            </div>
          )}

          {children}
        </main>
      </div>

      {/* ── Mobile Bottom Navigation Bar (Strictly md:hidden on Desktop) ──
          Visible only on screens < md (360px - 767px).
          Hidden in active chat view (/dashboard/chat/[id]) so the virtual keyboard and chat input are unobstructed.
      */}
      {!isChatView && (
        <nav className="md:hidden flex items-center justify-around px-2 py-2 border-t border-border bg-card/95 backdrop-blur-md z-30">
          {/* 1. Chats Tab */}
          <button
            type="button"
            onClick={() => {
              if (pathname !== '/dashboard') {
                router.push('/dashboard')
              }
              setMobileTab('chats')
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-colors cursor-pointer',
              isDashboardHome && mobileTab === 'chats'
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare className="w-5 h-5 pointer-events-none" />
            <span className="text-[10px] pointer-events-none">Chats</span>
          </button>

          {/* 2. Overview / Appointments */}
          <button
            type="button"
            onClick={() => {
              if (pathname !== '/dashboard') {
                router.push('/dashboard')
              }
              setMobileTab('overview')
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-colors cursor-pointer',
              isDashboardHome && mobileTab === 'overview'
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <CalendarCheck className="w-5 h-5 pointer-events-none" />
            <span className="text-[10px] pointer-events-none">Overview</span>
          </button>

          {/* 3. Simulate (Quick Test) */}
          <button
            type="button"
            onClick={() => setIsSimulateOpen(true)}
            className="flex flex-col items-center justify-center gap-1 py-1 px-3 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center pointer-events-none">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <span className="text-[10px] font-semibold pointer-events-none">Simulate</span>
          </button>

          {/* 4. Settings (Clean, direct click with z-50 and pointer-events-auto) */}
          <button
            type="button"
            onClick={() => router.push('/dashboard/settings')}
            className={cn(
              'relative z-50 pointer-events-auto flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-colors cursor-pointer',
              isSettingsView
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Clinic Settings"
          >
            <Settings className="w-5 h-5 pointer-events-none" />
            <span className="text-[10px] pointer-events-none">Settings</span>
          </button>

          {/* 5. Logout */}
          <button
            type="button"
            onClick={handleLogout}
            className="flex flex-col items-center justify-center gap-1 py-1 px-3 text-red-500 hover:text-red-600 transition-colors cursor-pointer"
            title="Sign out"
          >
            <LogOut className="w-5 h-5 pointer-events-none" />
            <span className="text-[10px] pointer-events-none">Logout</span>
          </button>
        </nav>
      )}

      {/* Global Simulate Modal for Mobile Nav & Quick Tests */}
      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onSuccess={(convId) => {
          setIsSimulateOpen(false)
          router.push(`/dashboard/chat/${convId}`)
        }}
      />
    </div>
  )
}
