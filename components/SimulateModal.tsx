'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  X,
  Send,
  Loader2,
  Calendar,
  Clock,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  MessageSquare,
} from 'lucide-react'

interface SimulateModalProps {
  isOpen: boolean
  onClose: () => void
  defaultPhone?: string
  defaultName?: string
  conversationId?: string
  onSuccess?: (convId: string) => void
}

const PRESET_MESSAGES = [
  {
    label: '📅 Book 11 AM Tomorrow',
    text: 'Hi, I have a severe toothache and would like to book an appointment for tomorrow at 11:00 AM. My name is Rahul Sharma.',
  },
  {
    label: '⏰ Timings & Fees',
    text: 'Hi! What are your clinic working hours, consultation fee, and where are you located?',
  },
  {
    label: '✨ Teeth Cleaning Cost',
    text: 'Hello, I want to get my teeth cleaned and polished. What is the price and do I need a prior appointment?',
  },
  {
    label: '🦷 Root Canal (RCT)',
    text: 'Do you perform Root Canal Treatment? How much does it cost and what slots are available?',
  },
]

export default function SimulateModal({
  isOpen,
  onClose,
  defaultPhone = '+91 98765 43210',
  defaultName = 'Rahul Sharma',
  conversationId,
  onSuccess,
}: SimulateModalProps) {
  const router = useRouter()
  const [patientName, setPatientName] = useState(defaultName)
  const [phone, setPhone] = useState(defaultPhone)
  const [message, setMessage] = useState(PRESET_MESSAGES[0].text)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    conversationId: string
    aiReply: string
    booking?: any
  } | null>(null)

  if (!isOpen) return null

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!message.trim() || loading) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          patientName: patientName.trim() || 'Test Patient',
          phone: phone.trim() || '+919876543210',
          conversationId: conversationId || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to simulate patient message')
      }

      setResult({
        conversationId: data.conversationId,
        aiReply: data.aiReply?.content || data.replyText || 'No reply received.',
        booking: data.booking,
      })

      if (onSuccess) {
        onSuccess(data.conversationId)
      }
    } catch (err: any) {
      console.error('Simulation error:', err)
      setError(err?.message || 'Error executing simulation')
    } finally {
      setLoading(false)
    }
  }

  const handleGoToChat = () => {
    if (result?.conversationId) {
      onClose()
      router.push(`/dashboard/chat/${result.conversationId}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="font-semibold text-base text-foreground leading-tight">
                Simulate Patient WhatsApp Message
              </h2>
              <p className="text-xs text-muted-foreground">
                Tests AI Receptionist (Gemini 2.5 Flash), Google Calendar & Sheets live
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          {/* Patient Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Patient Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Rahul Sharma"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-background border border-border focus:border-emerald-500 focus:outline-none transition-all"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                WhatsApp Phone Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-background border border-border focus:border-emerald-500 focus:outline-none transition-all"
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Quick-Preset Chips */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-2">
              Quick Test Scenarios
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_MESSAGES.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setMessage(preset.text)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all text-left ${
                    message === preset.text
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  disabled={loading}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message Input */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Simulated Inbound Message
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type what the patient sends on WhatsApp..."
              className="w-full p-3 text-xs rounded-lg bg-background border border-border focus:border-emerald-500 focus:outline-none transition-all placeholder:text-muted-foreground leading-relaxed resize-none"
              disabled={loading}
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-start gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Simulation Failed</p>
                <p className="opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Result Card */}
          {result && (
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>AI Receptionist Responded</span>
                </div>
                {result.booking && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                    <Calendar className="w-3 h-3" /> Booking Created: {result.booking.bookingId}
                  </span>
                )}
              </div>

              {/* AI Reply Bubble */}
              <div className="p-3 rounded-lg bg-background border border-border text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                {result.aiReply}
              </div>

              {/* Sync Status Indicators */}
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Supabase Logged
                </span>
                {result.booking && (
                  <>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <FileSpreadsheet className="w-3 h-3" />
                      Google Sheets Appended
                    </span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Calendar className="w-3 h-3" />
                      Calendar Verified
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {result && (
              <button
                type="button"
                onClick={handleGoToChat}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-muted hover:bg-muted/80 text-foreground border border-border flex items-center gap-1.5 transition-all"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Open in Chat View</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={loading || !message.trim()}
              className="px-5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing AI...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Message</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
