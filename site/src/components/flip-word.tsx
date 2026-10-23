"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, m } from "motion/react"

import { cn } from "@/lib"

const INTERVAL_MS = 2600

const SLOT = { type: "spring", stiffness: 520, damping: 34, mass: 0.8 } as const

// One word at a time rolls up like a slot machine reel: the old word slides up and out, the next
// slides up from below, and the box eases to the new word's width so the text after it (a comma,
// "in your cookbook") follows. Each word can carry its own colour.
export function FlipWord({
  words,
  colors,
  className,
}: {
  words: string[]
  colors?: string[]
  className?: string
}) {
  const [index, setIndex] = useState(0)
  const [widths, setWidths] = useState<number[]>([])
  const sizers = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [words.length])

  // Measure every word once the font is ready, so the box can animate between exact widths.
  useLayoutEffect(() => {
    const measure = () => setWidths(sizers.current.map((el) => el?.getBoundingClientRect().width ?? 0))
    measure()
    document.fonts?.ready.then(measure)
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [words])

  const width = widths[index]

  return (
    <m.span
      className={cn("relative inline-block overflow-hidden whitespace-nowrap py-[0.14em] -my-[0.14em] align-bottom", className)}
      initial={false}
      animate={width ? { width } : undefined}
      transition={SLOT}
    >
      {/* Invisible copies give the width of each word, and the height while a word is leaving. */}
      <span aria-hidden="true" className="invisible absolute top-0 left-0 whitespace-nowrap">
        {words.map((word, i) => (
          <span key={word} ref={(el) => void (sizers.current[i] = el)} className="absolute top-0 left-0">
            {word}
          </span>
        ))}
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={words[index]}
          aria-hidden="true"
          className="block"
          style={colors?.[index] ? { color: colors[index] } : undefined}
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "-110%" }}
          transition={SLOT}
        >
          {words[index]}
        </m.span>
      </AnimatePresence>
      <span className="sr-only">{words[index]}</span>
    </m.span>
  )
}
