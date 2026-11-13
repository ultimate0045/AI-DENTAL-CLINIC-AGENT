import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-service-key'

/**
 * Universal Supabase client for browser, client components, and pages (uses Anon key)
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Helper to get a client-side Supabase client
 */
export function createBrowserClient() {
  return createClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Server-side Admin Supabase client using Service Role Key (bypasses RLS)
 * Safe to use in API routes, server endpoints, and background handlers without next/headers.
 */
export function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
