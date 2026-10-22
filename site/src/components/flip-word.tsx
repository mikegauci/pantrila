"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib"

const INTERVAL_MS = 2600

// One word at a time flips out and the next flips in. Only the shown word takes up room, so the
// text after it (a comma, "in your cookbook") sits right beside it whichever word is showing.
export function FlipWord({ words, className }: { words: string[]; className?: string }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [words.length])

  return (
    <span className={cn("relative inline-block [perspective:700px]", className)}>
      {words.map((word, i) => (
        <span
          key={word}
          aria-hidden="true"
          className={cn(
            "origin-center whitespace-nowrap transition-[transform,opacity] duration-500 ease-out [backface-visibility:hidden] motion-reduce:transition-none",
            i === index
              ? "relative opacity-100 [transform:rotateX(0deg)]"
              : "absolute top-0 left-0 opacity-0 [transform:rotateX(90deg)]",
          )}
        >
          {word}
        </span>
      ))}
      <span className="sr-only">{words[index]}</span>
    </span>
  )
}
