"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, m } from "motion/react"
import { Bell, Check, Link2, Mic } from "lucide-react"

import { EASE_OUT, usePhases } from "@/components/motion"
import { cn } from "@/lib"

// Small cards that float over the "up close" screenshots and act out one thing the app does.
// They loop while on screen, are decorative (the screenshot's alt text describes the feature)
// and show their finished state to visitors who ask for less motion.

function DemoCard({ children, className, cardRef }: { children: React.ReactNode; className?: string; cardRef: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={cardRef}
      aria-hidden="true"
      className={cn(
        "w-[232px] rounded-2xl border border-border bg-surface/95 p-4 text-[13px] leading-[18px] shadow-lift backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  )
}

function Tick({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground", className)}>
      <Check className="size-2.5" strokeWidth={3} />
    </span>
  )
}

// Plan: a day fills in meal by meal and its energy bar lands on target.
const PLAN_MEALS = [
  { type: "Breakfast", name: "Spinach omelette", kcal: 821 },
  { type: "Lunch", name: "Smashed chickpea sandwich", kcal: 477 },
  { type: "Dinner", name: "Quinoa buddha bowl", kcal: 720 },
]
const PLAN_PHASES = [700, 650, 650, 900, 3400]

export function PlanDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(PLAN_PHASES, ref)
  const shown = Math.min(phase, PLAN_MEALS.length)
  const kcal = PLAN_MEALS.slice(0, shown).reduce((sum, meal) => sum + meal.kcal, 0)
  const done = phase === PLAN_PHASES.length - 1

  return (
    <DemoCard cardRef={ref} className={className}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-bold">Day 1</span>
        <span className="rounded-full bg-yellow px-2 py-0.5 text-[11px] font-semibold">Today</span>
      </div>
      <ul className="space-y-1.5">
        {PLAN_MEALS.map((meal, i) => (
          <m.li
            key={meal.type}
            className="rounded-lg border border-border px-2.5 py-1.5"
            animate={i < shown ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
          >
            <div className="flex justify-between text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span>{meal.type}</span>
              <span className="normal-case">{meal.kcal} kcal</span>
            </div>
            <div className="truncate font-medium">{meal.name}</div>
          </m.li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between text-[12px]">
        <span className="text-muted-foreground">Energy</span>
        <span className="font-semibold tabular-nums">{kcal} / 2000 kcal</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <m.div
          className="h-full rounded-full bg-foreground"
          animate={{ width: `${Math.min(100, (kcal / 2000) * 100)}%` }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        />
      </div>
      <m.div
        className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-primary-text"
        animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
        transition={{ duration: 0.35 }}
      >
        <Tick /> Meets your targets, no rule broken
      </m.div>
    </DemoCard>
  )
}

// Ask: a question, the assistant typing, then a reply that cites a recipe.
const ASK_REPLY = "Try the chickpea curry. It uses your chickpeas, spinach and onion."
const ASK_PHASES = [600, 900, 1200, 1900, 3600]

export function AskDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(ASK_PHASES, ref)
  const pop = { initial: { opacity: 0, y: 6, scale: 0.96 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0 } }

  return (
    <DemoCard cardRef={ref} className={cn("min-h-[208px] space-y-2", className)}>
      <AnimatePresence initial={false}>
        {phase >= 1 && (
          <m.div key="q" {...pop} className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
            Dinner with chickpeas and spinach?
          </m.div>
        )}
        {phase === 2 && (
          <m.div key="typing" {...pop} className="flex w-fit gap-1 rounded-2xl rounded-bl-md bg-surface-muted px-3 py-3">
            {[0, 1, 2].map((i) => (
              <m.span
                key={i}
                className="size-1.5 rounded-full bg-muted-foreground"
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </m.div>
        )}
        {phase >= 3 && (
          <m.div key="a" {...pop} className="w-fit max-w-[95%] rounded-2xl rounded-bl-md bg-surface-muted px-3 py-2">
            {ASK_REPLY.split(" ").map((word, i) => (
              <m.span
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: i * 0.07 }}
              >
                {word}{" "}
              </m.span>
            ))}
          </m.div>
        )}
        {phase >= 4 && (
          <m.div key="chip" {...pop} className="w-fit rounded-full border border-primary/25 bg-primary-soft px-3 py-1 text-[12px] font-medium text-primary-text">
            Chickpea Curry · 398 kcal
          </m.div>
        )}
      </AnimatePresence>
    </DemoCard>
  )
}

// Save: a post link goes in and the import steps tick off, as on the new-recipe page.
const SAVE_STEPS = ["Reading the caption", "Following the creator’s link", "Working out nutrition"]
const SAVE_PHASES = [600, 1100, 1100, 1100, 3400]

function Spinner() {
  return (
    <m.span
      className="size-4 shrink-0 rounded-full border-2 border-primary/25 border-t-primary"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    />
  )
}

export function SaveDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(SAVE_PHASES, ref)
  const done = Math.max(0, Math.min(phase - 1, SAVE_STEPS.length))
  const saved = phase === SAVE_PHASES.length - 1

  return (
    <DemoCard cardRef={ref} className={className}>
      <div className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-[12px]">
        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
        <m.span
          className="truncate"
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
          transition={{ duration: 0.3 }}
        >
          instagram.com/reel/C9x…
        </m.span>
      </div>
      <ul className="space-y-2">
        {SAVE_STEPS.map((step, i) => (
          <li key={step} className={cn("flex items-center gap-2 transition-colors", (i > done || phase === 0) && "text-muted-foreground/60")}>
            {i < done ? <Tick /> : i === done && phase >= 1 ? <Spinner /> : <span className="size-4 shrink-0 rounded-full border-2 border-border" />}
            {step}
          </li>
        ))}
      </ul>
      <m.div
        className="mt-3 rounded-lg bg-primary-soft px-2.5 py-2 text-[12px] font-semibold text-primary-text"
        animate={saved ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
      >
        Saved: 12 ingredients, 6 steps, creator credited
      </m.div>
    </DemoCard>
  )
}

// Cook: the mic hears "start timer", a timer runs, then "next" moves on a step.
const COOK_PHASES = [1400, 1300, 5000, 1300, 3000]
const COOK_SECONDS = 120

function Countdown() {
  const [left, setLeft] = useState(COOK_SECONDS)
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <TimerRing left={left} />
}

function TimerRing({ left }: { left: number }) {
  const r = 22
  const length = 2 * Math.PI * r
  return (
    <div className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - left / COOK_SECONDS)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="text-[12px] font-bold tabular-nums">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>
    </div>
  )
}

export function CookDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePhases(COOK_PHASES, ref)
  const heard = phase === 1 ? "start timer" : phase === 3 ? "next" : null
  const timing = phase >= 2

  return (
    <DemoCard cardRef={ref} className={className}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="relative grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
          <m.span
            className="absolute inset-0 rounded-full bg-primary"
            animate={{ scale: [1, 1.6], opacity: [0.45, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
          <Mic className="relative size-4" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">Listening</div>
          <div className="h-[18px] text-[12px] text-muted-foreground">
            <AnimatePresence mode="wait" initial={false}>
              {heard ? (
                <m.span key={heard} className="flex items-center gap-1 font-medium text-primary-text" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                  <Bell className="size-3" /> “{heard}”
                </m.span>
              ) : (
                <m.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Say “next” or “start timer”
                </m.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-surface-muted p-2.5">
        {timing ? <Countdown key="running" /> : <TimerRing left={COOK_SECONDS} />}
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <m.div key={phase >= 4 ? 4 : 3} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.25 }}>
              <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Step {phase >= 4 ? 4 : 3} of 7
              </div>
              <div className="font-medium">{phase >= 4 ? "Stir in the spinach" : "Simmer for 2 minutes"}</div>
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </DemoCard>
  )
}
