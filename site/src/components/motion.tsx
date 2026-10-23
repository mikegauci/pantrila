"use client"

import { useEffect, useRef, useState } from "react"
import { LazyMotion, MotionConfig, animate, domAnimation, m, useInView } from "motion/react"

// Motion loads only the DOM animation features, and visitors who ask their system for less
// motion get fades without movement (MotionConfig "user"). Counters and demo loops still run
// for them: they change numbers and text in place, with no sliding or spinning. Components use `m.*`, never `motion.*`.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

export const EASE_OUT = [0.22, 1, 0.36, 1] as const

type RevealProps = {
  children: React.ReactNode
  className?: string
  delay?: number
  x?: number
  y?: number
}

// Fades and slides a block in the first time it scrolls into view.
export function Reveal({ children, className, delay = 0, x = 0, y = 18 }: RevealProps) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, x, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.65, ease: EASE_OUT, delay }}
    >
      {children}
    </m.div>
  )
}

const list = { hidden: {}, shown: { transition: { staggerChildren: 0.08 } } }
const item = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
}

// A list whose items come in one after another.
export function StaggerList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <m.ul className={className} variants={list} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.15 }}>
      {children}
    </m.ul>
  )
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <m.li className={className} variants={item}>
      {children}
    </m.li>
  )
}

// Counts up from 0 the first time it is seen. The server renders the final number, so the
// page reads right without JavaScript.
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.6 })
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (!seen) return
    const controls = animate(0, value, {
      duration: 1.4,
      ease: EASE_OUT,
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => controls.stop()
  }, [seen, value])

  return (
    <span ref={ref} className="tabular-nums">
      {shown}
      {suffix}
    </span>
  )
}

// Steps through a demo's phases while it is on screen and loops; each entry is how long that
// phase holds, in ms. Pass a module-level array so the timer is not reset on every render.
export function usePhases(durations: readonly number[], ref: React.RefObject<Element | null>) {
  const visible = useInView(ref, { amount: 0.4 })
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setPhase((p) => (p + 1) % durations.length), durations[phase])
    return () => window.clearTimeout(timer)
  }, [phase, visible, durations])

  return phase
}
