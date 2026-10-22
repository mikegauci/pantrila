"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib"

const INTERVAL_MS = 2600

// One word at a time flips out and the next flips in. All words share one grid cell, so the
// heading keeps the width of the longest word and nothing below it moves.
export function FlipWord({ words, className }: { words: string[]; className?: string }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [words.length])

  return (
    <span className={cn("inline-grid [perspective:700px]", className)}>
      {words.map((word, i) => (
        <span
          key={word}
          aria-hidden="true"
          className={cn(
            "col-start-1 row-start-1 origin-center transition-[transform,opacity] duration-500 ease-out [backface-visibility:hidden] motion-reduce:transition-none",
            i === index ? "opacity-100 [transform:rotateX(0deg)]" : "opacity-0 [transform:rotateX(90deg)]",
          )}
        >
          {word}
        </span>
      ))}
      <span className="sr-only">{words[index]}</span>
    </span>
  )
}
