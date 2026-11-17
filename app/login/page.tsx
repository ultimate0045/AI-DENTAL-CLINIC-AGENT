'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Stethoscope, Loader2, Lock, Mail, AlertCircle, ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingInitialAuth, setCheckingInitialAuth] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Redirect immediately if already authenticated
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && mounted) {
        router.replace('/dashboard')
      } else if (mounted) {
        setCheckingInitialAuth(false)
      }
    }).catch(() => {
      if (mounted) setCheckingInitialAuth(false)
    })
    return () => {
      mounted = false
    }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setErrorMsg('Invalid email or password. Please verify your credentials.')
      } else if (data.session) {
        router.replace('/dashboard')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingInitialAuth) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#EFEAE2] dark:bg-[#0B141A]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
            <Stethoscope className="w-6 h-6 text-emerald-500 animate-pulse" />
          </div>
          <p className="text-xs text-muted-foreground font-medium">Checking authorization...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[#EFEAE2] dark:bg-[#0B141A] overflow-x-hidden">
      <Card className="w-full max-w-sm sm:max-w-md shadow-xl border-border/60 bg-card rounded-2xl">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner border border-emerald-500/20">
            <Stethoscope className="w-8 h-8 text-emerald-500" />
          </div>
          <CardTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            Clinic Receptionist Portal
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Autonomous WhatsApp AI Receptionist & Clinic Operations
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {errorMsg && (
            <div className="p-3 text-xs rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-start gap-2">
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
                <Mail className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@dentalclinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-10 text-xs rounded-xl"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-10 text-xs rounded-xl"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-10 rounded-xl text-xs transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Authenticating...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </Button>
          </form>

          <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Strict Authenticated Access Only</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
