import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/components/auth-provider"
import { userKey } from "@/lib/auth"

/** A small setting kept on this phone for the signed-in person (`userKey`, so sign-out forgets
 * it). `undefined` until it has been read; `null` when it was never set. */
export function useStored(name: string): [string | null | undefined, (value: string | null) => void] {
  const userId = useAuth().session?.user.id ?? null
  const key = userId ? userKey(userId, name) : null
  const [state, setState] = useState<{ key: string | null; value: string | null | undefined }>({ key: null, value: undefined })

  useEffect(() => {
    if (!key) return
    let live = true
    AsyncStorage.getItem(key).then((v) => { if (live) setState({ key, value: v }) },
                                   () => { if (live) setState({ key, value: null }) })
    return () => { live = false }
  }, [key])

  const set = useCallback((value: string | null) => {
    if (!key) return
    setState({ key, value })
    ;(value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)).catch(() => {})
  }, [key])

  return [state.key === key ? state.value : undefined, set]
}
