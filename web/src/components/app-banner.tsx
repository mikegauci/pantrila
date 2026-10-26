"use client"

import { Smartphone, X } from "lucide-react"
import { useEffect, useState } from "react"

import { PLAY_STORE_URL } from "@/lib/stores"

const OFF = "pantrila-app-banner-off"

/** "Pantrila for Android" above the header on an Android phone's browser, once the Play listing is
 *  live. iPhones get Safari's own banner from the `apple-itunes-app` tag (root layout) instead.
 *  Closing it hides it on this browser for good. */
export function AppBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!PLAY_STORE_URL || !/Android.+Mobile/i.test(navigator.userAgent)) return
    if (matchMedia("(display-mode: standalone)").matches) return
    try {
      if (localStorage.getItem(OFF)) return
    } catch {}
    setShow(true)  // eslint-disable-line react-hooks/set-state-in-effect -- the browser is known only here
  }, [])

  if (!show || !PLAY_STORE_URL) return null

  function close() {
    try {
      localStorage.setItem(OFF, "1")
    } catch {}
    setShow(false)
  }

  return (
    <div role="region" aria-label="Pantrila for Android"
         className="flex items-center gap-3 border-b bg-primary-soft px-4 py-2 text-[13px] md:hidden">
      <Smartphone className="size-4 shrink-0 text-primary-text" aria-hidden />
      <p className="flex-1">Pantrila for Android: share recipes in from any app, and timers that ring when locked.</p>
      <a href={PLAY_STORE_URL} className="shrink-0 font-semibold text-primary-text underline underline-offset-4">Get it</a>
      <button type="button" onClick={close} aria-label="Close" className="-mr-1 grid size-7 shrink-0 place-items-center rounded-full">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
