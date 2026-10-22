"use client"

import { m } from "motion/react"
import { ShieldCheck } from "lucide-react"

import { EASE_OUT } from "@/components/motion"

// The 14 allergens EU food law requires labels for, ticked off one by one the first time the
// panel is seen, then the plan is approved. Decorative: the section text says the same.
const ALLERGENS = [
  "Gluten",
  "Crustaceans",
  "Eggs",
  "Fish",
  "Peanuts",
  "Soy",
  "Milk",
  "Tree nuts",
  "Celery",
  "Mustard",
  "Sesame",
  "Sulphites",
  "Lupin",
  "Molluscs",
]
const STEP = 0.14

const chip = {
  hidden: { backgroundColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" },
  shown: (i: number) => ({
    backgroundColor: "rgba(168,224,176,0.16)",
    color: "#ffffff",
    transition: { delay: 0.3 + i * STEP, duration: 0.3 },
  }),
}
const check = {
  hidden: { pathLength: 0, opacity: 0 },
  shown: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: { delay: 0.3 + i * STEP, duration: 0.35, ease: EASE_OUT },
  }),
}
const verdict = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  shown: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { delay: 0.5 + ALLERGENS.length * STEP, type: "spring" as const, stiffness: 260, damping: 18 },
  },
}

export function AllergenCheck() {
  return (
    <m.div
      aria-hidden="true"
      className="mx-auto max-w-3xl rounded-2xl bg-white/[0.05] p-5 ring-1 ring-white/10 sm:p-6"
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.5 }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-semibold">Checking every meal in your week</span>
        <span className="text-white/60">21 meals · your rules: no peanuts, no milk</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {ALLERGENS.map((name, i) => (
          <m.li
            key={name}
            custom={i}
            variants={chip}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 ring-white/10"
          >
            <svg viewBox="0 0 12 12" className="size-3 text-[#a8e0b0]">
              <m.path
                custom={i}
                variants={check}
                d="M2.5 6.2 5 8.5l4.5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {name}
          </m.li>
        ))}
      </ul>
      <m.div
        variants={verdict}
        className="mt-5 flex w-fit items-center gap-2 rounded-xl bg-[#a8e0b0] px-4 py-2.5 text-[14px] font-bold text-primary-deep"
      >
        <ShieldCheck className="size-4" />
        Plan approved
      </m.div>
    </m.div>
  )
}
