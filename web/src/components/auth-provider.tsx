"use client"

import type { Session } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useState } from "react"

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
    auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }))
    const { data } = auth.onAuthStateChange((_event, session) => setState({ session, ready: true }))
    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext value={state}>{children}</AuthContext>
}

export const useAuth = () => useContext(AuthContext)
