import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/components/auth-provider"
import { userKey } from "@/lib/auth"

/** The foods ticked off the grocery list for one plan, kept on this phone for the signed-in
 * person (sign-out forgets them with the rest of `userKey`). */
export function useTicked(planId: number | null): [Set<string>, (food: string) => void] {
  const userId = useAuth().session?.user.id ?? null
  const key = userId && planId != null ? userKey(userId, `grocery:${planId}`) : null
  const [state, setState] = useState<{ key: string | null; foods: Set<string> }>({ key: null, foods: new Set() })

  useEffect(() => {
    if (!key) return
    let live = true
    AsyncStorage.getItem(key).then((raw) => {
      if (live) setState({ key, foods: new Set(raw ? (JSON.parse(raw) as string[]) : []) })
    }, () => {})
    return () => { live = false }
  }, [key])

  const foods = state.key === key ? state.foods : new Set<string>()
  const toggle = useCallback((food: string) => {
    if (!key) return
    setState((old) => {
      const next = new Set(old.key === key ? old.foods : [])
      if (next.has(food)) next.delete(food)
      else next.add(food)
      AsyncStorage.setItem(key, JSON.stringify([...next])).catch(() => {})
      return { key, foods: next }
    })
  }, [key])
  return [foods, toggle]
}
