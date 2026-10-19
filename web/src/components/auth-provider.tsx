"use client"

import type { Session } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useState } from "react"

import { SWRConfig } from "swr"

import { supabase } from "@/lib/supabase"

interface AuthState {
  session: Session | null
  ready: boolean
}

const AuthContext = createContext<AuthState>({ session: null, ready: false })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, ready: false })

  useEffect(() => {
    const auth = supabase().auth
    const { data } = auth.onAuthStateChange((_event, session) => setState({ session, ready: true }))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext value={state}>
      <AccountCache key={state.session?.user.id ?? "signed-out"}>{children}</AccountCache>
    </AuthContext>
  )
}

export const useAuth = () => useContext(AuthContext)

/** Recreate both cached responses and retained page state whenever identity changes. */
function AccountCache({ children }: { children: React.ReactNode }) {
  const [cache] = useState(() => new Map())
  return <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
}
