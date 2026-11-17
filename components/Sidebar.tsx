'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Search,
  Settings,
  Moon,
  Sun,
  LogOut,
  Bot,
  User,
  MessageSquare,
  Sparkles,
  Stethoscope,
  ChevronRight,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { getInitials, formatRelativeTime, formatPhone, truncateText, cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import SimulateModal from '@/components/SimulateModal'

export interface SidebarConversation {
  id: string
  phone_number: string
  patient_name?: string
  last_message?: string
  last_message_at?: string
  ai_mode?: boolean
  unread_count?: number
}

interface SidebarProps {
  conversations?: SidebarConversation[]
  onSelectConversation?: (id: string) => void
  clinicName?: string
  className?: string
}

export default function Sidebar({
  conversations: propConversations,
  onSelectConversation,
  clinicName = 'Dental Receptionist',
  className,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggleTheme, isDark } = useTheme()
  const [conversations, setConversations] = useState<SidebarConversation[]>(propConversations || [])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSimulateOpen, setIsSimulateOpen] = useState(false)

  const loadConversations = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/conversations')
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations || [])
      }
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch conversations if not passed in props
  useEffect(() => {
    if (propConversations && propConversations.length > 0) {
      setConversations(propConversations)
      return
    }

    loadConversations()
  }, [propConversations])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Filter conversations by name or phone or message
  const filtered = conversations.filter((c) => {
    const q = searchQuery.toLowerCase()
    const name = (c.patient_name || '').toLowerCase()
    const phone = (c.phone_number || '').toLowerCase()
    const msg = (c.last_message || '').toLowerCase()
    return name.includes(q) || phone.includes(q) || msg.includes(q)
  })

  return (
    <aside className={cn("flex flex-col h-full w-full md:w-[340px] lg:w-[380px] border-r border-border bg-card flex-shrink-0 relative", className)}>
      {/* 1. Header with clinic branding */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <Stethoscope className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h2 className="font-semibold text-sm leading-tight text-foreground truncate max-w-[160px]">
              {clinicName}
            </h2>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>WhatsApp AI Live</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 relative z-50">
          {/* Settings button */}
          <button
            type="button"
            onClick={() => router.push('/dashboard/settings')}
            title="Clinic Settings"
            aria-label="Clinic Settings"
            className={cn(
              "p-2 rounded-full hover:bg-muted transition-colors cursor-pointer relative z-50 pointer-events-auto",
              pathname === '/dashboard/settings'
                ? 'text-emerald-500 bg-emerald-500/10'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Settings className="w-4 h-4 pointer-events-none" />
          </button>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-2 rounded-full hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>
        </div>
      </div>

      {/* 2. Simulator CTA + Search bar */}
      <div className="p-3 border-b border-border/60 space-y-2">
        <button
          onClick={() => setIsSimulateOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600/15 via-teal-600/10 to-emerald-600/15 hover:from-emerald-600/25 hover:to-emerald-600/25 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 text-xs font-semibold shadow-sm transition-all group"
          title="Simulate incoming WhatsApp message from patient"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-500 group-hover:scale-110 transition-transform" />
          <span>Simulate Patient Message</span>
        </button>

        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patients or messages..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-muted/60 border border-transparent focus:border-emerald-500 focus:bg-background focus:outline-none transition-all placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* 3. Conversation Thread List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground text-xs">
            <span className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
            Loading chats...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground text-xs space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">No conversations yet</p>
              <p className="text-[11px] leading-relaxed mt-1">
                Meta WhatsApp is on Standby. Click below to simulate a patient asking questions or booking an appointment!
              </p>
            </div>
            <button
              onClick={() => setIsSimulateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Simulate Patient Message</span>
            </button>
          </div>
        ) : (
          filtered.map((conv) => {
            const isActive = pathname === `/dashboard/chat/${conv.id}`
            const displayName = conv.patient_name || formatPhone(conv.phone_number)
            const initials = getInitials(conv.patient_name || conv.phone_number)
            const isAIMode = conv.ai_mode !== false

            return (
              <Link
                key={conv.id}
                href={`/dashboard/chat/${conv.id}`}
                onClick={() => onSelectConversation?.(conv.id)}
                className={`flex items-start gap-3 p-3 transition-colors hover:bg-muted/50 cursor-pointer ${
                  isActive ? 'bg-muted/80 border-l-4 border-emerald-500' : ''
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-semibold text-xs flex items-center justify-center border border-emerald-500/20">
                    {initials}
                  </div>
                  {/* Mode indicator pill on avatar */}
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] shadow-sm ${
                      isAIMode ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
                    }`}
                    title={isAIMode ? 'AI Auto-Reply Active' : 'Human Receptionist Active'}
                  >
                    {isAIMode ? <Bot className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-semibold text-xs text-foreground truncate">
                      {displayName}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {formatRelativeTime(conv.last_message_at || '')}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground truncate leading-normal">
                    {conv.last_message || 'New conversation'}
                  </p>

                  <div className="flex items-center justify-between mt-1.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        isAIMode
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {isAIMode ? (
                        <>
                          <Sparkles className="w-2.5 h-2.5" /> AI Mode
                        </>
                      ) : (
                        <>
                          <User className="w-2.5 h-2.5" /> Human Mode
                        </>
                      )}
                    </span>

                    {(conv.unread_count || 0) > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>

      {/* 4. Bottom footer */}
      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs relative z-40">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium transition-colors cursor-pointer"
        >
          <MessageSquare className="w-4 h-4" />
          <span>All Chats</span>
        </Link>

        <button
          type="button"
          onClick={() => router.push('/dashboard/settings')}
          className={cn(
            "flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium transition-colors cursor-pointer",
            pathname === '/dashboard/settings' && "text-emerald-600 dark:text-emerald-400 font-semibold"
          )}
          title="Clinic Settings & Integrations"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-1 text-red-500 hover:text-red-600 transition-colors cursor-pointer"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </button>
      </div>

      {/* 5. Simulator Modal */}
      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onSuccess={() => loadConversations()}
      />
    </aside>
  )
}
