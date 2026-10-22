"use client"

// Copied from web/src/components/logo.tsx; keep the mark in sync with web/src/app/icon.svg.
import { useId } from "react"

import { cn } from "@/lib"

// One four-point "AI" sparkle, centred on 0,0 with a radius of 1.
const SPARKLE = "M0-1C.12-.32.32-.12 1 0C.32.12.12.32 0 1C-.12.32-.32.12-1 0C-.32-.12-.12-.32 0-1Z"

// The chef hat mark from src/app/icon.svg: the big sparkle is cut out of the
// hat, so the tile colour shows through it. Each copy needs its own mask id: pages
// render several logos (some hidden by breakpoint) and a mask inside a hidden copy
// draws nothing, which would leave every logo a plain square.
function Mark({ className }: { className?: string }) {
  const mask = `pantrila-logo-cut-${useId().replace(/[^\w-]/g, "")}`
  return (
    <svg viewBox="8 9 84 84" className={className} aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <g fill="#fff">
          <circle cx="33" cy="46" r="14" />
          <circle cx="50" cy="37" r="17" />
          <circle cx="67" cy="46" r="14" />
          <rect x="30" y="46" width="40" height="20" />
          <rect x="30" y="70" width="40" height="12" rx="3" />
        </g>
        <path fill="#000" transform="translate(50 52) scale(13)" d={SPARKLE} />
      </mask>
      <rect width="100" height="100" fill="currentColor" mask={`url(#${mask})`} />
      <g fill="currentColor">
        <path transform="translate(77 22) scale(5.5)" d={SPARKLE} />
        <path transform="translate(84 31) scale(2.8)" d={SPARKLE} />
      </g>
    </svg>
  )
}

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 font-bold text-foreground", className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Mark className="size-6" />
      </span>
      {!compact && <span className="text-[20px] tracking-tight">Pantrila</span>}
    </span>
  )
}
