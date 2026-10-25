"use client"

import { useEffect, useState } from "react"

import type { ProRequired } from "@pantrila/core/api"

import { ApiError } from "@/lib/api"

/** A Free cap was reached (the API's 402): one sheet in the app shell offers Pantrila Pro. */
const EVENT = "pantrila-pro-required"

/** Open the Pro sheet if `e` is a Free cap; returns whether it was one. */
export function askForPro(e: unknown): boolean {
  if (!(e instanceof ApiError) || !e.pro) return false
  window.dispatchEvent(new CustomEvent<ProRequired>(EVENT, { detail: e.pro }))
  return true
}

export function useProRequired(): [ProRequired | null, () => void] {
  const [asked, setAsked] = useState<ProRequired | null>(null)
  useEffect(() => {
    const open = (e: Event) => setAsked((e as CustomEvent<ProRequired>).detail)
    window.addEventListener(EVENT, open)
    return () => window.removeEventListener(EVENT, open)
  }, [])
  return [asked, () => setAsked(null)]
}
