"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib"

// The header sits clear on the hero and turns frosted, with a line and a shadow, once the
// page scrolls.
export function ScrollHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-[background-color,border-color,box-shadow] duration-300",
        scrolled ? "border-border/70 bg-background/80 shadow-soft backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      {children}
    </header>
  )
}
