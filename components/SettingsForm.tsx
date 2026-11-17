'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ClinicSettings } from '@/types/index'
import * as Tabs from '@radix-ui/react-tabs'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Plus, Trash2, CheckCircle2, XCircle, Loader2,
  Upload, FileText, AlertCircle, Info, Clock,
  Link2, Settings2, Eye, EyeOff, Copy, Check, ShieldCheck, Key, RefreshCw, ArrowLeft
} from 'lucide-react'

// ─── Local sub-types ────────────────────────────────────────────────────────

interface Service {
  id: string
  name: string
  price: number
  durationMinutes: number
}

interface FAQ {
  id: string
  question: string
  answer: string
}

// Extended settings with services & faqs & kb
interface ExtendedSettings extends ClinicSettings {
  services: Service[]
  faqs: FAQ[]
  knowledgeBaseText: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAYS = ['None', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function generateSystemPrompt(s: ExtendedSettings): string {
  const services = s.services.map(sv => `- ${sv.name}: ₹${sv.price} (${sv.durationMinutes} min)`).join('\n')
  const faqs = s.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
  return `You are a friendly dental receptionist AI for ${s.clinicName || '[Clinic Name]'}, managed by ${s.doctorName || '[Doctor Name]'}.

Clinic Address: ${s.address || '[Address]'}
Contact: ${s.phone || '[Phone]'}
Working Hours: ${s.timingsStart || '09:00'} – ${s.timingsEnd || '18:00'}
Lunch Break: ${s.lunchStart || '13:00'} – ${s.lunchEnd || '14:00'}
Weekly Off: ${s.weeklyOff || 'Sunday'}
Consultation Fee: ₹${s.consultationFee || 0}

Services Offered:
${services || '(No services listed yet)'}

Frequently Asked Questions:
${faqs || '(No FAQs added yet)'}

Your responsibilities:
1. Greet patients warmly and answer questions about clinic hours, location, fees, and services.
2. Help schedule, reschedule, or cancel appointments.
3. Provide information about dental procedures and costs.
4. If you cannot help, politely say so and suggest the patient call the clinic directly.
5. Never share personal patient data or medical records.
6. Always confirm appointment details before booking.`
}

// ─── Field wrapper ───────────────────────────────────────────────────────────

function Field({
  label, hint, children, required
}: {
  label: string; hint?: string; children: React.ReactNode; required?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

type ConnStatus = 'idle' | 'testing' | 'ok' | 'fail'

function StatusBadge({ status }: { status: ConnStatus }) {
  if (status === 'idle') return null
  if (status === 'testing') return <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Testing…</span>
  if (status === 'ok') return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />Connected</span>
  return <span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="h-3 w-3" />Failed</span>
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast { id: string; msg: string; type: 'success' | 'error' }

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm text-white transition-all',
            t.type === 'success' ? 'bg-[#25D366]' : 'bg-red-500'
          )}
        >
          {t.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  open, onConfirm, onCancel, title, description
}: {
  open: boolean; onConfirm: () => void; onCancel: () => void
  title: string; description: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-[#1f2c33] rounded-xl p-6 w-full max-w-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-gray-600 dark:text-gray-400 mb-6">{description}</Dialog.Description>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={onConfirm}>Confirm</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── Main SettingsForm ────────────────────────────────────────────────────────

interface SettingsFormProps {
  initialSettings: ClinicSettings
  onSave: (settings: ClinicSettings) => Promise<void>
}

export function SettingsForm({ initialSettings, onSave }: SettingsFormProps) {
  // Extended state
  const [form, setForm] = useState<ExtendedSettings>({
    ...initialSettings,
    metaAccessToken: initialSettings.metaAccessToken || '',
    metaPhoneNumberId: initialSettings.metaPhoneNumberId || '',
    metaVerifyToken: initialSettings.metaVerifyToken || '',
    googleServiceAccountJson: initialSettings.googleServiceAccountJson || '',
    geminiApiKey: initialSettings.geminiApiKey || '',
    geminiModel: initialSettings.geminiModel || '',
    services: (initialSettings as any).services ?? [],
    faqs: (initialSettings as any).faqs ?? [],
    knowledgeBaseText: (initialSettings as any).knowledgeBaseText ?? '',
  })
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activeTab, setActiveTab] = useState('clinic')

  // Integrations state
  const [sheetStatus, setSheetStatus] = useState<ConnStatus>('idle')
  const [calStatus, setCalStatus] = useState<ConnStatus>('idle')
  const [setupDialogOpen, setSetupDialogOpen] = useState(false)
  const [isSettingUp, setIsSettingUp] = useState(false)

  // WhatsApp Meta & Secret fields state
  const [metaStatus, setMetaStatus] = useState<ConnStatus>('idle')
  const [metaDetail, setMetaDetail] = useState('')
  const [showMetaToken, setShowMetaToken] = useState(false)
  const [showVerifyToken, setShowVerifyToken] = useState(false)
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showServiceAccount, setShowServiceAccount] = useState(false)
  const [copiedWebhook, setCopiedWebhook] = useState(false)

  // Sync form when initialSettings loads asynchronously
  useEffect(() => {
    setForm(prev => ({
      ...prev,
      ...initialSettings,
      metaAccessToken: initialSettings.metaAccessToken ?? prev.metaAccessToken ?? '',
      metaPhoneNumberId: initialSettings.metaPhoneNumberId ?? prev.metaPhoneNumberId ?? '',
      metaVerifyToken: initialSettings.metaVerifyToken ?? prev.metaVerifyToken ?? '',
      googleServiceAccountJson: initialSettings.googleServiceAccountJson ?? prev.googleServiceAccountJson ?? '',
      geminiApiKey: initialSettings.geminiApiKey ?? prev.geminiApiKey ?? '',
      geminiModel: initialSettings.geminiModel ?? prev.geminiModel ?? '',
      services: (initialSettings as any).services ?? prev.services ?? [],
      faqs: (initialSettings as any).faqs ?? prev.faqs ?? [],
      knowledgeBaseText: (initialSettings as any).knowledgeBaseText ?? prev.knowledgeBaseText ?? '',
    }))
  }, [initialSettings])

  // KB state
  const [kbFile, setKbFile] = useState<File | null>(null)
  const [kbUploading, setKbUploading] = useState(false)
  const [kbFiles, setKbFiles] = useState<{ name: string; chars: number; id: string }[]>([])
  const [kbSaving, setKbSaving] = useState(false)

  const addToast = useCallback((msg: string, type: 'success' | 'error') => {
    const id = uid()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const update = useCallback(<K extends keyof ExtendedSettings>(key: K, val: ExtendedSettings[K]) => {
    setForm(prev => ({ ...prev, [key]: val }))
    setIsDirty(true)
    setErrors(prev => ({ ...prev, [key]: undefined }))
  }, [])

  async function testMeta() {
    if (!form.metaPhoneNumberId?.trim()) {
      addToast('Enter a WhatsApp Phone Number ID first', 'error')
      return
    }
    setMetaStatus('testing')
    setMetaDetail('')
    try {
      const res = await fetch('/api/whatsapp/test')
      const data = await res.json()
      if (data.success) {
        setMetaStatus('ok')
        setMetaDetail(`${data.displayName || 'Connected'} (${data.qualityRating || 'OK'})`)
        addToast(`WhatsApp connected: ${data.displayName || 'OK'}`, 'success')
      } else {
        setMetaStatus('fail')
        setMetaDetail(data.error || 'Connection failed')
        addToast(data.error || 'Meta connection test failed', 'error')
      }
    } catch (err: any) {
      setMetaStatus('fail')
      setMetaDetail(err?.message || 'Network error')
      addToast(err?.message || 'Meta connection test failed', 'error')
    }
  }

  function copyWebhookUrl() {
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}/webhook`
      : 'https://your-domain.com/webhook'
    navigator.clipboard.writeText(url)
    setCopiedWebhook(true)
    addToast('Webhook Callback URL copied to clipboard!', 'success')
    setTimeout(() => setCopiedWebhook(false), 2500)
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Partial<Record<string, string>> = {}
    if (!form.clinicName.trim()) errs.clinicName = 'Clinic Name is required'
    if (!form.doctorName.trim()) errs.doctorName = 'Doctor Name is required'
    if (form.timingsStart && form.timingsEnd && form.timingsStart >= form.timingsEnd)
      errs.timingsEnd = 'End time must be after start time'
    if (form.lunchStart && form.lunchEnd && form.lunchStart >= form.lunchEnd)
      errs.lunchEnd = 'Lunch end must be after lunch start'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) {
      setActiveTab('clinic')
      addToast('Please fix the validation errors', 'error')
      return
    }
    setIsSaving(true)
    try {
      await onSave(form as unknown as ClinicSettings)
      setIsDirty(false)
      addToast('Settings saved successfully!', 'success')
    } catch (e: any) {
      addToast(e?.message ?? 'Failed to save settings', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Services ─────────────────────────────────────────────────────────────────
  function addService() {
    setForm(prev => ({
      ...prev,
      services: [...prev.services, { id: uid(), name: '', price: 0, durationMinutes: 30 }]
    }))
    setIsDirty(true)
  }
  function removeService(id: string) {
    setForm(prev => ({ ...prev, services: prev.services.filter(s => s.id !== id) }))
    setIsDirty(true)
  }
  function updateService(id: string, field: keyof Service, val: string | number) {
    setForm(prev => ({
      ...prev,
      services: prev.services.map(s => s.id === id ? { ...s, [field]: val } : s)
    }))
    setIsDirty(true)
  }

  // ── FAQs ─────────────────────────────────────────────────────────────────────
  function addFaq() {
    setForm(prev => ({
      ...prev,
      faqs: [...prev.faqs, { id: uid(), question: '', answer: '' }]
    }))
    setIsDirty(true)
  }
  function removeFaq(id: string) {
    setForm(prev => ({ ...prev, faqs: prev.faqs.filter(f => f.id !== id) }))
    setIsDirty(true)
  }
  function updateFaq(id: string, field: keyof FAQ, val: string) {
    setForm(prev => ({
      ...prev,
      faqs: prev.faqs.map(f => f.id === id ? { ...f, [field]: val } : f)
    }))
    setIsDirty(true)
  }

  // ── Integrations ──────────────────────────────────────────────────────────────
  async function testSheet() {
    if (!form.googleSheetId.trim()) { addToast('Enter a Google Sheet ID first', 'error'); return }
    setSheetStatus('testing')
    try {
      const res = await fetch(`/api/sheets/status?sheetId=${encodeURIComponent(form.googleSheetId.trim())}`)
      const data = await res.json()
      const isOk = Boolean(data.success || data.connected)
      setSheetStatus(isOk ? 'ok' : 'fail')
      if (isOk) {
        addToast(`Google Sheets connected: ${data.title || 'OK'}`, 'success')
      } else {
        addToast(data.error || 'Google Sheets connection failed', 'error')
      }
    } catch (err: any) {
      setSheetStatus('fail')
      addToast(err?.message || 'Failed to test Google Sheets connection', 'error')
    }
  }

  async function testCalendar() {
    if (!form.googleCalendarId.trim()) { addToast('Enter a Google Calendar ID first', 'error'); return }
    setCalStatus('testing')
    try {
      const res = await fetch(`/api/calendar/status?calendarId=${encodeURIComponent(form.googleCalendarId.trim())}`)
      const data = await res.json()
      const isOk = Boolean(data.success || data.connected)
      setCalStatus(isOk ? 'ok' : 'fail')
      if (isOk) {
        addToast(`Google Calendar connected: ${data.summary || 'OK'}`, 'success')
      } else {
        addToast(data.error || 'Google Calendar connection failed', 'error')
      }
    } catch (err: any) {
      setCalStatus('fail')
      addToast(err?.message || 'Failed to test Google Calendar connection', 'error')
    }
  }

  async function setupSheetHeaders() {
    if (!form.googleSheetId.trim()) {
      addToast('Please enter and save a Google Sheet ID first', 'error')
      return
    }
    setIsSettingUp(true)
    setSetupDialogOpen(false)
    try {
      const res = await fetch('/api/sheets/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: form.googleSheetId.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        addToast(data.message || 'Sheet headers set up successfully!', 'success')
        setSheetStatus('ok')
      } else {
        addToast(data.error ?? 'Setup failed', 'error')
      }
    } catch (err: any) {
      addToast(err?.message || 'Setup failed — network error', 'error')
    } finally {
      setIsSettingUp(false)
    }
  }

  // ── KB Upload ─────────────────────────────────────────────────────────────────
  async function handleKbUpload() {
    if (!kbFile) return
    setKbUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', kbFile)
      const res = await fetch('/api/upload-kb', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) {
        setKbFiles(prev => [...prev, { name: data.fileName, chars: data.charCount, id: uid() }])
        setKbFile(null)
        addToast(`Uploaded "${data.fileName}" (${data.charCount.toLocaleString()} chars)`, 'success')
      } else {
        addToast(data.error ?? 'Upload failed', 'error')
      }
    } catch { addToast('Upload failed — network error', 'error') }
    finally { setKbUploading(false) }
  }

  async function handleKbSave() {
    setKbSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeBaseText: form.knowledgeBaseText }),
      })
      const data = await res.json()
      if (data.success) addToast('Knowledge base text saved!', 'success')
      else addToast(data.error ?? 'Save failed', 'error')
    } catch { addToast('Save failed — network error', 'error') }
    finally { setKbSaving(false) }
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  const tabCls = (val: string) =>
    cn(
      'px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex-shrink-0',
      'data-[state=active]:bg-[#25D366] data-[state=active]:text-white shadow-sm',
      'data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-100',
      'dark:data-[state=inactive]:text-gray-300 dark:data-[state=inactive]:hover:bg-[#2A3942]'
    )

  const inputCls = (err?: string) =>
    cn('w-full', err && 'border-red-400 focus:ring-red-400')

  return (
    <div className="relative w-full overflow-x-hidden">
      <ToastContainer toasts={toasts} />
      <ConfirmDialog
        open={setupDialogOpen}
        title="Setup Sheet Headers"
        description="This will create or overwrite worksheet tabs in your Google Sheet with predefined headers. Existing data may be affected. Are you sure?"
        onConfirm={setupSheetHeaders}
        onCancel={() => setSetupDialogOpen(false)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg"
            title="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Settings2 className="h-6 w-6 text-[#25D366] flex-shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
            ⚙️ Clinic Settings
          </h1>
          {isDirty && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex-shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Unsaved
            </span>
          )}
        </div>
        <Button onClick={handleSave} loading={isSaving} disabled={isSaving} className="w-full sm:w-auto min-w-32 rounded-xl">
          {isSaving ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto no-scrollbar -mx-1 px-1 mb-6">
          <Tabs.List className="flex gap-1.5 p-1 bg-gray-100 dark:bg-[#2A3942] rounded-xl w-max min-w-full sm:min-w-0">
            {[
              { val: 'clinic', label: 'Clinic Info' },
              { val: 'services', label: 'Services & Pricing' },
              { val: 'integrations', label: 'Integrations' },
              { val: 'ai', label: 'AI & Knowledge Base' },
            ].map(t => (
              <Tabs.Trigger key={t.val} value={t.val} className={tabCls(t.val)}>
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        {/* ── Tab 1: Clinic Info ─────────────────────────────────────────────── */}
        <Tabs.Content value="clinic" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Clinic Name" required hint="The official name of the clinic">
              <Input
                value={form.clinicName}
                onChange={e => update('clinicName', e.target.value)}
                placeholder="City Dental Clinic"
                className={inputCls(errors.clinicName)}
              />
              {errors.clinicName && <p className="text-xs text-red-500 mt-0.5">{errors.clinicName}</p>}
            </Field>

            <Field label="Doctor Name" required hint="Primary dentist / practitioner">
              <Input
                value={form.doctorName}
                onChange={e => update('doctorName', e.target.value)}
                placeholder="Dr. Priya Sharma"
                className={inputCls(errors.doctorName)}
              />
              {errors.doctorName && <p className="text-xs text-red-500 mt-0.5">{errors.doctorName}</p>}
            </Field>

            <Field label="Address" hint="Full clinic address visible to patients">
              <textarea
                value={form.address}
                onChange={e => update('address', e.target.value)}
                rows={3}
                placeholder="123 Main Street, Mumbai, MH 400001"
                className={cn(
                  'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm resize-none',
                  'placeholder:text-gray-400 text-gray-900',
                  'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                  'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100 dark:placeholder:text-gray-500'
                )}
              />
            </Field>

            <div className="space-y-5">
              <Field label="Phone Number" hint="Clinic contact number">
                <Input
                  value={form.phone}
                  onChange={e => update('phone', e.target.value)}
                  placeholder="+91 98765 43210"
                  type="tel"
                />
              </Field>
              <Field label="Consultation Fee (₹)" hint="Default fee shown to patients">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                  <Input
                    value={form.consultationFee}
                    onChange={e => update('consultationFee', Number(e.target.value))}
                    type="number"
                    min={0}
                    step={50}
                    className="pl-7"
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* Working hours */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#25D366]" /> Working Hours
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Opens At">
                <Input type="time" value={form.timingsStart} onChange={e => update('timingsStart', e.target.value)} />
              </Field>
              <Field label="Closes At">
                <Input type="time" value={form.timingsEnd} onChange={e => update('timingsEnd', e.target.value)} />
                {errors.timingsEnd && <p className="text-xs text-red-500 mt-0.5">{errors.timingsEnd}</p>}
              </Field>
              <Field label="Lunch Start">
                <Input type="time" value={form.lunchStart} onChange={e => update('lunchStart', e.target.value)} />
              </Field>
              <Field label="Lunch End">
                <Input type="time" value={form.lunchEnd} onChange={e => update('lunchEnd', e.target.value)} />
                {errors.lunchEnd && <p className="text-xs text-red-500 mt-0.5">{errors.lunchEnd}</p>}
              </Field>
            </div>
            <Field label="Weekly Off Day" hint="Day the clinic remains closed">
              <select
                value={form.weeklyOff}
                onChange={e => update('weeklyOff', e.target.value)}
                className={cn(
                  'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm h-10',
                  'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                  'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100'
                )}
              >
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
        </Tabs.Content>

        {/* ── Tab 2: Services & Pricing ──────────────────────────────────────── */}
        <Tabs.Content value="services" className="space-y-6">
          {/* Services */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Dental Services</h3>
              <Button variant="outline" size="sm" onClick={addService}>
                <Plus className="h-3.5 w-3.5" /> Add Service
              </Button>
            </div>
            {form.services.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-[#3B4A54] rounded-lg">
                No services added yet. Click "Add Service" to get started.
              </p>
            )}
            <div className="space-y-3">
              {form.services.map((svc, i) => (
                <div key={svc.id} className="flex gap-3 items-start p-3 border border-gray-200 dark:border-[#3B4A54] rounded-lg bg-gray-50 dark:bg-[#1f2c33]">
                  <span className="text-xs text-gray-400 mt-2.5 w-5 shrink-0 text-right">{i + 1}.</span>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Service Name">
                      <Input
                        value={svc.name}
                        onChange={e => updateService(svc.id, 'name', e.target.value)}
                        placeholder="Root Canal"
                      />
                    </Field>
                    <Field label="Price (₹)">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                        <Input
                          value={svc.price}
                          onChange={e => updateService(svc.id, 'price', Number(e.target.value))}
                          type="number" min={0} step={100}
                          className="pl-7"
                        />
                      </div>
                    </Field>
                    <Field label="Duration (min)">
                      <Input
                        value={svc.durationMinutes}
                        onChange={e => updateService(svc.id, 'durationMinutes', Number(e.target.value))}
                        type="number" min={5} step={5}
                      />
                    </Field>
                  </div>
                  <button onClick={() => removeService(svc.id)} className="mt-6 p-1.5 rounded-md text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* FAQs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Frequently Asked Questions</h3>
              <Button variant="outline" size="sm" onClick={addFaq}>
                <Plus className="h-3.5 w-3.5" /> Add FAQ
              </Button>
            </div>
            {form.faqs.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-[#3B4A54] rounded-lg">
                No FAQs added yet. Add common questions your patients ask.
              </p>
            )}
            <div className="space-y-3">
              {form.faqs.map((faq, i) => (
                <div key={faq.id} className="flex gap-3 items-start p-3 border border-gray-200 dark:border-[#3B4A54] rounded-lg bg-gray-50 dark:bg-[#1f2c33]">
                  <span className="text-xs text-gray-400 mt-2.5 w-5 shrink-0 text-right">{i + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <Field label="Question">
                      <Input
                        value={faq.question}
                        onChange={e => updateFaq(faq.id, 'question', e.target.value)}
                        placeholder="What is the cost of a cleaning?"
                      />
                    </Field>
                    <Field label="Answer">
                      <textarea
                        value={faq.answer}
                        onChange={e => updateFaq(faq.id, 'answer', e.target.value)}
                        rows={2}
                        placeholder="A routine dental cleaning costs ₹800 and takes about 30 minutes."
                        className={cn(
                          'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm resize-none',
                          'placeholder:text-gray-400 text-gray-900',
                          'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                          'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100 dark:placeholder:text-gray-500'
                        )}
                      />
                    </Field>
                  </div>
                  <button onClick={() => removeFaq(faq.id)} className="mt-6 p-1.5 rounded-md text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Tabs.Content>

        {/* ── Tab 3: Integrations ────────────────────────────────────────────── */}
        <Tabs.Content value="integrations" className="space-y-6">
          {/* WhatsApp Meta Business API Section */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-5 bg-white dark:bg-[#1f2c33]/50">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#3B4A54] pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">💬</span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">WhatsApp Meta Cloud API</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Configure your Meta Developer Account and Phone credentials</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Production Ready
              </span>
            </div>

            {/* Phone Number ID */}
            <Field
              label="WhatsApp Phone Number ID"
              hint="Found in Meta App Dashboard → WhatsApp → API Setup → Phone number ID"
              required
            >
              <div className="flex gap-2">
                <Input
                  value={form.metaPhoneNumberId || ''}
                  onChange={e => { update('metaPhoneNumberId', e.target.value); setMetaStatus('idle') }}
                  placeholder="e.g. 1441716485692503"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testMeta}
                  disabled={metaStatus === 'testing' || !form.metaPhoneNumberId?.trim()}
                  className="shrink-0"
                >
                  {metaStatus === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Test Connection
                </Button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <StatusBadge status={metaStatus} />
                {metaDetail && (
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                    {metaDetail}
                  </span>
                )}
                {initialSettings.hasMetaPhoneId && metaStatus === 'idle' && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Saved in Database
                  </span>
                )}
              </div>
            </Field>

            {/* Permanent Access Token */}
            <Field
              label="Meta Permanent Access Token (System User Token)"
              hint="Generate from Meta Business Manager → Users → System Users with whatsapp_business_messaging and whatsapp_business_management permissions. Saved securely in Supabase."
              required
            >
              <div className="relative flex items-center">
                <Input
                  type={showMetaToken ? 'text' : 'password'}
                  value={form.metaAccessToken || ''}
                  onChange={e => update('metaAccessToken', e.target.value)}
                  placeholder={
                    initialSettings.hasMetaToken
                      ? '•••••••••••••••• (Leave unchanged to keep current token)'
                      : 'EAAY... (Paste Permanent Meta Token)'
                  }
                  className="font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowMetaToken(!showMetaToken)}
                  className="absolute right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  tabIndex={-1}
                >
                  {showMetaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {initialSettings.hasMetaToken && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Active token configured. Enter a new token only to replace it.
                </p>
              )}
            </Field>

            {/* Webhook Verify Token */}
            <Field
              label="Webhook Verify Token"
              hint="A private secret string you choose (e.g. clinic_secret_2026). Must match what you enter in Meta Webhook configuration."
              required
            >
              <div className="relative flex items-center">
                <Input
                  type={showVerifyToken ? 'text' : 'password'}
                  value={form.metaVerifyToken || ''}
                  onChange={e => update('metaVerifyToken', e.target.value)}
                  placeholder="e.g. my_custom_clinic_verify_token"
                  className="font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowVerifyToken(!showVerifyToken)}
                  className="absolute right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  tabIndex={-1}
                >
                  {showVerifyToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {/* Webhook Callback URL Card */}
            <div className="rounded-lg bg-gray-50 dark:bg-[#2A3942] p-4 border border-gray-200 dark:border-[#3B4A54] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-[#25D366]" /> Live Webhook Callback URL
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyWebhookUrl}
                  className="h-7 text-xs gap-1.5"
                >
                  {copiedWebhook ? <Check className="h-3.5 w-3.5 text-[#25D366]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedWebhook ? 'Copied!' : 'Copy URL'}
                </Button>
              </div>
              <div className="p-2.5 rounded bg-white dark:bg-[#1f2c33] border border-gray-200 dark:border-[#3B4A54] font-mono text-xs text-gray-800 dark:text-gray-200 break-all select-all">
                {typeof window !== 'undefined' ? `${window.location.origin}/webhook` : 'https://your-domain.com/webhook'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p className="font-medium text-gray-700 dark:text-gray-300">How to link with Meta:</p>
                <ol className="list-decimal list-inside space-y-0.5 pl-1">
                  <li>In Meta App Dashboard, go to <strong>WhatsApp → Configuration</strong>.</li>
                  <li>Click <strong>Edit</strong> next to Webhook, paste the Callback URL above, and enter your <strong>Webhook Verify Token</strong>.</li>
                  <li>Click <strong>Verify and Save</strong>, then click <strong>Manage</strong> webhook fields and subscribe to <code>messages</code>.</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Google Sheets */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-4 bg-white dark:bg-[#1f2c33]/50">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span className="text-lg">📊</span> Google Sheets
            </h3>
            <Field label="Google Sheet ID" hint="Found in the spreadsheet URL: docs.google.com/spreadsheets/d/[SHEET_ID]/...">
              <div className="flex gap-2">
                <Input
                  value={form.googleSheetId}
                  onChange={e => { update('googleSheetId', e.target.value); setSheetStatus('idle') }}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={testSheet} disabled={sheetStatus === 'testing'} className="shrink-0">
                  <Link2 className="h-3.5 w-3.5" /> Test
                </Button>
              </div>
              <div className="mt-1"><StatusBadge status={sheetStatus} /></div>
            </Field>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary" size="sm"
                onClick={() => setSetupDialogOpen(true)}
                disabled={!form.googleSheetId.trim() || isSettingUp}
                loading={isSettingUp}
              >
                📋 Setup Sheet Headers
              </Button>
              <p className="text-xs text-gray-500 dark:text-gray-400">Creates Appointments and Patients_Leads tabs with predefined headers</p>
            </div>
          </div>

          {/* Google Calendar */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-4 bg-white dark:bg-[#1f2c33]/50">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span className="text-lg">📅</span> Google Calendar
            </h3>
            <Field label="Google Calendar ID" hint="Found in Calendar Settings → Integrate calendar. Usually looks like an email address or group ID.">
              <div className="flex gap-2">
                <Input
                  value={form.googleCalendarId}
                  onChange={e => { update('googleCalendarId', e.target.value); setCalStatus('idle') }}
                  placeholder="clinic@gmail.com or abc123@group.calendar.google.com"
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={testCalendar} disabled={calStatus === 'testing'} className="shrink-0">
                  <Link2 className="h-3.5 w-3.5" /> Test
                </Button>
              </div>
              <div className="mt-1"><StatusBadge status={calStatus} /></div>
            </Field>
          </div>

          {/* AI & Custom Credentials Overrides (Optional) */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-4 bg-white dark:bg-[#1f2c33]/50">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#3B4A54] pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  AI & Credentials Overrides (Optional)
                </h3>
              </div>
              <span className="text-xs text-gray-400 font-mono">Multi-tenant / Client overrides</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Leave these fields blank to automatically use the server's default environment variables. Provide values here only if this clinic uses dedicated Google/Gemini accounts.
            </p>

            {/* Gemini API Key */}
            <Field
              label="Google Gemini API Key"
              hint="Custom Gemini API key for this clinic. Falls back to server GEMINI_API_KEY if left blank."
            >
              <div className="relative flex items-center">
                <Input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={form.geminiApiKey || ''}
                  onChange={e => update('geminiApiKey', e.target.value)}
                  placeholder={
                    initialSettings.hasGeminiKey
                      ? '•••••••••••••••• (Leave unchanged to keep current key)'
                      : 'AIzaSy... (Optional override)'
                  }
                  className="font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  tabIndex={-1}
                >
                  {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {/* Gemini Model */}
            <Field
              label="Gemini Model"
              hint="Recommended: gemini-3.5-flash-lite for instant sub-second responses on WhatsApp."
            >
              <select
                value={form.geminiModel || 'gemini-3.5-flash-lite'}
                onChange={e => update('geminiModel', e.target.value)}
                className={cn(
                  'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm h-10',
                  'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                  'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100 font-mono text-xs'
                )}
              >
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Recommended — Ultra-fast)</option>
                <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-flash-lite-latest">gemini-flash-lite-latest</option>
              </select>
            </Field>

            {/* Google Service Account JSON */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Google Service Account Key (JSON Override)
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowServiceAccount(!showServiceAccount)}
                  className="h-7 text-xs"
                >
                  {showServiceAccount ? 'Hide JSON' : 'Show / Edit JSON'}
                </Button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Optional JSON override for Google Calendar and Sheets access. If empty, the server's default service account is used.
              </p>
              {showServiceAccount && (
                <textarea
                  value={form.googleServiceAccountJson || ''}
                  onChange={e => update('googleServiceAccountJson', e.target.value)}
                  rows={6}
                  placeholder={`{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----...",\n  "client_email": "..."\n}`}
                  className={cn(
                    'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-mono resize-y',
                    'placeholder:text-gray-400 text-gray-900',
                    'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                    'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100'
                  )}
                />
              )}
            </div>
          </div>
        </Tabs.Content>

        {/* ── Tab 4: AI & Knowledge Base ─────────────────────────────────────── */}
        <Tabs.Content value="ai" className="space-y-6">
          {/* AI Model */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">🤖 AI Model</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">Active Model:</span>
              <code className="px-2 py-1 rounded bg-gray-100 dark:bg-[#1f2c33] text-sm font-mono text-[#25D366]">
                {form.geminiModel || 'gemini-3.5-flash-lite'}
              </code>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Configured dynamically in the <strong>Integrations</strong> tab under AI & Credentials Overrides.
            </p>
          </div>

          {/* System Prompt Preview */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">📝 System Prompt Preview</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Auto-generated from your clinic settings. Update the Clinic Info tab to change this.</p>
            <pre className={cn(
              'w-full rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-mono',
              'text-gray-800 overflow-auto max-h-72 whitespace-pre-wrap leading-relaxed',
              'dark:border-[#3B4A54] dark:bg-[#1f2c33] dark:text-gray-200'
            )}>
              {generateSystemPrompt(form)}
            </pre>
          </div>

          {/* File Upload */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">📂 Knowledge Base Files</h3>
            <div className="flex items-center gap-3">
              <label className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md border-2 border-dashed cursor-pointer',
                'border-gray-300 hover:border-[#25D366] text-sm text-gray-600 transition-colors',
                'dark:border-[#3B4A54] dark:text-gray-400 dark:hover:border-[#25D366]'
              )}>
                <Upload className="h-4 w-4" />
                {kbFile ? kbFile.name : 'Choose PDF or .txt file'}
                <input
                  type="file"
                  accept=".pdf,.txt"
                  className="hidden"
                  onChange={e => setKbFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {kbFile && (
                <Button size="sm" onClick={handleKbUpload} loading={kbUploading} disabled={kbUploading}>
                  Upload
                </Button>
              )}
            </div>

            {/* Uploaded KB files list */}
            {kbFiles.length > 0 && (
              <div className="space-y-2">
                {kbFiles.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-[#1f2c33] rounded-md border border-gray-200 dark:border-[#3B4A54]">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#25D366]" />
                      <span className="text-sm text-gray-800 dark:text-gray-200">{f.name}</span>
                      <span className="text-xs text-gray-500">({f.chars.toLocaleString()} chars)</span>
                    </div>
                    <button
                      onClick={() => setKbFiles(prev => prev.filter(kf => kf.id !== f.id))}
                      className="p-1 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual KB text */}
          <div className="border border-gray-200 dark:border-[#3B4A54] rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">✏️ Manual Knowledge Base Text</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Add any additional information the AI should know — procedures, policies, pricing notes, etc.</p>
            <textarea
              value={form.knowledgeBaseText}
              onChange={e => update('knowledgeBaseText', e.target.value)}
              rows={10}
              placeholder="Enter clinic-specific knowledge here…&#10;&#10;Example:&#10;- We offer EMI options for treatments above ₹10,000&#10;- Senior citizens get a 10% discount&#10;- Parking available in the basement"
              className={cn(
                'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm resize-y',
                'placeholder:text-gray-400 text-gray-900',
                'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
                'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100 dark:placeholder:text-gray-500'
              )}
            />
            <Button size="sm" variant="secondary" onClick={handleKbSave} loading={kbSaving} disabled={kbSaving}>
              Save Knowledge Base
            </Button>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {/* Sticky bottom save bar when form is dirty */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 md:left-[340px] lg:left-[380px] right-0 z-40 bg-white dark:bg-[#1f2c33] border-t border-gray-200 dark:border-[#3B4A54] px-4 sm:px-6 py-3 flex items-center justify-between shadow-lg">
          <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            You have unsaved changes
          </span>
          <div className="flex gap-3">
            <Button
              variant="outline" size="sm"
              onClick={() => { setForm({ ...initialSettings, services: (initialSettings as any).services ?? [], faqs: (initialSettings as any).faqs ?? [], knowledgeBaseText: (initialSettings as any).knowledgeBaseText ?? '' }); setIsDirty(false) }}
            >
              Discard
            </Button>
            <Button size="sm" onClick={handleSave} loading={isSaving} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Settings'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsForm
