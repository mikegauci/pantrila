import type { Session } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useState } from "react"
import { SWRConfig } from "swr"

import { purchaser } from "@/lib/purchases"
import { identify } from "@/lib/sentry"
import { supabase, supabaseReady } from "@/lib/supabase"

interface AuthState {
  session: Session | null
  ready: boolean
}

const AuthContext = createContext<AuthState>({ session: null, ready: false })

/** The Supabase session for the whole app; `ready` once the stored session has been read. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Without Supabase settings there is no session to wait for: the welcome screen says so.
  const [state, setState] = useState<AuthState>({ session: null, ready: !supabaseReady() })

  useEffect(() => {
    if (!supabaseReady()) return
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      identify(session?.user.id ?? null)  // error reports name the account by its id, nothing more
      purchaser(session?.user.id ?? null)  // Pro is bought as the same id, so the API's webhook knows whose
      setState({ session, ready: true })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext value={state}>
      <AccountCache key={state.session?.user.id ?? "signed-out"}>{children}</AccountCache>
    </AuthContext>
  )
}

export const useAuth = () => useContext(AuthContext)

/** A new SWR cache whenever the person changes, so one account never sees another's data
 * (as the web's account isolation does). */
function AccountCache({ children }: { children: React.ReactNode }) {
  const [cache] = useState(() => new Map())
  return <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
}
