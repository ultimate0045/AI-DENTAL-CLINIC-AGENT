'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Bot,
  User,
  Send,
  Sparkles,
  Phone,
  Calendar,
  Check,
  CheckCheck,
  ShieldAlert,
  Loader2,
  Paperclip,
  Smile,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useSocket } from '@/hooks/useSocket'
import { formatTime, formatPhone, getInitials } from '@/lib/utils'
import { ChatMessage } from '@/types/index'
import SimulateModal from '@/components/SimulateModal'

interface ChatWindowProps {
  conversationId: string
  conversation?: {
    id: string
    phone_number: string
    patient_name?: string
    ai_mode?: boolean
  }
}

export default function ChatWindow({
  conversationId,
  conversation: initialConv,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversation, setConversation] = useState(initialConv)
  const [aiMode, setAiMode] = useState<boolean>(initialConv?.ai_mode !== false)
  const [inputText, setInputText] = useState('')
  const [patientInput, setPatientInput] = useState('')
  const [sending, setSending] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isSimulateOpen, setIsSimulateOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
        if (data.conversation) {
          setConversation(data.conversation)
          setAiMode(data.conversation.ai_mode !== false)
        }
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setLoading(false)
    }
  }

  // 1. Fetch initial message history
  useEffect(() => {
    setLoading(true)
    if (conversationId) {
      fetchHistory()
    }
  }, [conversationId])

  // 2. Real-time updates via useSocket
  const handleNewMessage = (newMsg: ChatMessage) => {
    setMessages((prev) => {
      // Deduplicate by id or timestamp + content
      const exists = prev.some((m) => m.id === newMsg.id)
      if (exists) return prev
      return [...prev, newMsg]
    })
  }

  const handleAIModeChange = (newMode: boolean) => {
    setAiMode(newMode)
  }

  const { sendMessage, toggleAIMode } = useSocket(
    conversationId,
    handleNewMessage,
    handleAIModeChange
  )

  // 3. Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 4. Handle toggling AI mode
  const handleToggle = (checked: boolean) => {
    setAiMode(checked)
    toggleAIMode(checked)
  }

  // 5. Handle manual send (Human Receptionist mode)
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim() || sending) return

    const phone = conversation?.phone_number || ''
    const textToSend = inputText.trim()
    setInputText('')
    setSending(true)

    // Optimistic local add
    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      conversationId,
      role: 'assistant',
      content: textToSend,
      timestamp: new Date().toISOString(),
      status: 'sent',
    }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      await sendMessage(textToSend, phone)
    } catch (err) {
      console.error('Failed to send:', err)
    } finally {
      setSending(false)
    }
  }

  // 6. Handle simulated patient message (triggers real AI flow)
  const handleSendAsPatient = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!patientInput.trim() || simulating) return

    const textToSend = patientInput.trim()
    setPatientInput('')
    setSimulating(true)

    // Optimistic local add of patient message
    const tempId = `temp-${Date.now()}`
    const optUserMsg: ChatMessage = {
      id: tempId,
      conversationId,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
      status: 'delivered',
    }
    setMessages((prev) => [...prev, optUserMsg])

    try {
      const res = await fetch('/api/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          phone: conversation?.phone_number || '+919876543210',
          patientName: conversation?.patient_name || 'Patient',
          message: textToSend,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        if (data.aiReply) {
          const aiMsg: ChatMessage = {
            id: data.aiReply.id || `ai-${Date.now()}`,
            conversationId,
            role: 'assistant',
            content: data.aiReply.content || data.replyText,
            timestamp: data.aiReply.created_at || new Date().toISOString(),
            status: 'sent',
          }
          setMessages((prev) => {
            const withoutTemp = prev.filter((m) => m.id !== tempId)
            const actualUserMsg: ChatMessage = {
              id: data.userMessage?.id || tempId,
              conversationId,
              role: 'user',
              content: textToSend,
              timestamp: data.userMessage?.created_at || new Date().toISOString(),
              status: 'delivered',
            }
            return [...withoutTemp, actualUserMsg, aiMsg]
          })
        }
      }
    } catch (err) {
      console.error('Failed to simulate message in chat:', err)
    } finally {
      setSimulating(false)
    }
  }

  const displayName = conversation?.patient_name || formatPhone(conversation?.phone_number || '')
  const phone = conversation?.phone_number || ''

  return (
    <div className="flex flex-col h-full bg-[#EFEAE2] dark:bg-[#0B141A] relative select-none">
      {/* ── 1. Top Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-background border-b border-border z-10">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="w-10 h-10 rounded-full bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-semibold text-xs flex items-center justify-center border border-emerald-500/20">
            {getInitials(displayName)}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm text-foreground">{displayName}</h2>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                {formatPhone(phone)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>WhatsApp Active</span>
            </div>
          </div>
        </div>

        {/* Action Buttons & AI Toggle */}
        <div className="flex items-center gap-2">
          {/* Quick Simulate Button */}
          <button
            onClick={() => setIsSimulateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-colors shadow-sm"
            title="Simulate incoming WhatsApp message for this patient"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <span className="hidden sm:inline">Simulate Patient</span>
          </button>

          {/* AI Mode vs Human Receptionist Mode Toggle */}
          <div className="flex items-center gap-3 bg-muted/50 px-3 py-1.5 rounded-full border border-border">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {aiMode ? (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Bot className="w-4 h-4" />
                  <span className="hidden sm:inline">AI Auto-Reply</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">Human Mode</span>
                </span>
              )}
            </div>

            <Switch
              checked={aiMode}
              onCheckedChange={handleToggle}
              className="data-[state=checked]:bg-emerald-600"
              aria-label="Toggle AI or Human mode"
            />
          </div>
        </div>
      </div>

      {/* ── 2. Message Stream ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-opacity-30">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="text-xs">Loading chat history...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
              <Bot className="w-6 h-6" />
            </div>
            <p className="font-semibold text-foreground text-sm">Conversation Started</p>
            <p className="text-xs max-w-sm mt-1 text-muted-foreground">
              Patient messages from WhatsApp will appear here. The AI receptionist is configured to assist them automatically.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.role === 'user'
            return (
              <div
                key={msg.id || i}
                className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
              >
                {/* Sender badge */}
                <span className="text-[10px] text-muted-foreground px-1 mb-0.5 flex items-center gap-1">
                  {isUser ? (
                    <>
                      <User className="w-2.5 h-2.5 text-muted-foreground" />
                      <span>{displayName}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-2.5 h-2.5 text-emerald-500" />
                      <span>AI Dental Receptionist</span>
                    </>
                  )}
                </span>

                {/* Message Bubble */}
                <div
                  className={`relative max-w-[85%] sm:max-w-[70%] px-3.5 py-2 rounded-2xl shadow-sm text-sm break-words select-text ${
                    isUser
                      ? 'bg-white dark:bg-[#202C33] text-foreground rounded-tl-none border border-border/40'
                      : 'bg-emerald-600 text-white dark:bg-[#005C4B] rounded-tr-none'
                  }`}
                >
                  {/* Media image if present */}
                  {msg.mediaUrl && (
                    <div className="mb-2 rounded-lg overflow-hidden border border-white/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={msg.mediaUrl}
                        alt="WhatsApp Attachment"
                        className="max-h-60 w-auto object-cover rounded"
                      />
                    </div>
                  )}

                  {/* Message Text */}
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>

                  {/* Timestamp & ticks */}
                  <div
                    className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                      isUser ? 'text-muted-foreground' : 'text-emerald-100/80'
                    }`}
                  >
                    <span>{formatTime(msg.timestamp)}</span>
                    {!isUser && <CheckCheck className="w-3 h-3 text-emerald-200" />}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 3. Bottom Action Bar ── */}
      <div className="p-3 bg-background border-t border-border">
        {aiMode ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-800 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <Bot className="w-3.5 h-3.5 text-emerald-500 animate-pulse flex-shrink-0" />
                <span className="text-[11px]">
                  <strong>AI Auto-Reply is ON.</strong> Type below to simulate what the patient sends on WhatsApp:
                </span>
              </div>
              <button
                onClick={() => handleToggle(false)}
                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 underline hover:text-emerald-700 whitespace-nowrap ml-2"
              >
                Take Over (Human)
              </button>
            </div>

            <form onSubmit={handleSendAsPatient} className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
                <span className="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Patient Mode
                </span>
              </div>

              <input
                type="text"
                value={patientInput}
                onChange={(e) => setPatientInput(e.target.value)}
                placeholder="Ask about dental issues, timings, fees, or book an appointment..."
                className="flex-1 px-4 py-2 text-xs rounded-xl bg-muted/60 border border-transparent focus:border-emerald-500 focus:bg-background focus:outline-none transition-all placeholder:text-muted-foreground"
                disabled={simulating}
              />

              <button
                type="submit"
                disabled={!patientInput.trim() || simulating}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm flex-shrink-0"
                title="Send message as patient to AI"
              >
                {simulating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden sm:inline">AI replying...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send as Patient</span>
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-500">
                Human Mode
              </span>
            </div>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a WhatsApp reply as dental receptionist..."
              className="flex-1 px-4 py-2 text-xs rounded-xl bg-muted/60 border border-transparent focus:border-emerald-500 focus:bg-background focus:outline-none transition-all"
              disabled={sending}
            />

            <button
              type="submit"
              disabled={!inputText.trim() || sending}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium transition-colors shadow-sm"
              title="Send WhatsApp message"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>

      {/* Simulator Modal */}
      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        defaultPhone={conversation?.phone_number}
        defaultName={conversation?.patient_name}
        conversationId={conversationId}
        onSuccess={() => fetchHistory()}
      />
    </div>
  )
}
