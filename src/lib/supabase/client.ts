import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | undefined

function resolveAuthStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  const remember = window.localStorage.getItem('loanmanage:remember') !== 'false'
  return remember ? window.localStorage : window.sessionStorage
}

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        storage: resolveAuthStorage(),
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  )
  return cached
}

/** Call before signUp/signIn so the session lands in the right storage. */
export function setRememberMe(remember: boolean) {
  window.localStorage.setItem('loanmanage:remember', remember ? 'true' : 'false')
  cached = undefined // force re-creation with the new storage on next getSupabaseClient()
}
