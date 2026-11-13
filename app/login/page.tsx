'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Stethoscope, Loader2, Lock, Mail, AlertCircle, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        // If Supabase credentials aren't set yet in development, allow bypassing to dashboard for inspection
        if (
          error.message?.includes('Invalid login') ||
          error.message?.includes('placeholder') ||
          !process.env.NEXT_PUBLIC_SUPABASE_URL
        ) {
          setErrorMsg(`${error.message}. (For development without Supabase, you can navigate directly to /dashboard)`)
        } else {
          setErrorMsg(error.message)
        }
      } else if (data.session) {
        router.push('/dashboard')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDemoAccess = () => {
    // Quick shortcut for local dev / testing
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[#EFEAE2] dark:bg-[#0B141A]">
      <Card className="w-full max-w-md shadow-xl border-border/60 bg-card">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
            <Stethoscope className="w-8 h-8 text-emerald-500" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">
            Clinic Receptionist Portal
          </CardTitle>
          <CardDescription className="text-xs">
            WhatsApp AI Receptionist & Appointment Booking SaaS Dashboard
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {errorMsg && (
            <div className="p-3 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium">
                Admin Email
              </Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@dentalclinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 text-xs"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 rounded-lg text-xs transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Signing in...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-card px-2 text-muted-foreground">Demo / Developer</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleDemoAccess}
            className="w-full text-xs border-dashed text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
            Enter Dashboard (Demo / Preview Mode)
          </Button>

          <p className="text-[11px] text-center text-muted-foreground pt-2">
            Multi-tenant & White-Label ready. Configured per clinic via <code className="text-emerald-500">.env.local</code> or the Settings tab.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
