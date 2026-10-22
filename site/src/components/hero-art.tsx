"use client"

import Image from "next/image"
import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react"

import { BrowserFrame, PhoneFrame } from "@/components/frames"
import { EASE_OUT } from "@/components/motion"

// Two soft blobs of the brand colours drift slowly behind the hero.
export function HeroGlow() {
  const reduced = useReducedMotion()
  const drift = (x: number[], y: number[], duration: number) =>
    reduced ? {} : { animate: { x, y }, transition: { duration, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const } }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[560px] overflow-hidden">
      <m.div
        className="absolute top-[-120px] right-[-8%] size-[620px] rounded-full bg-[radial-gradient(closest-side,var(--primary-soft),transparent)]"
        {...drift([0, -60, 20], [0, 40, -10], 18)}
      />
      <m.div
        className="absolute top-[40px] left-[-10%] size-[440px] rounded-full bg-[radial-gradient(closest-side,var(--accent-yellow-soft),transparent)]"
        {...drift([0, 50, -10], [0, -30, 20], 22)}
      />
    </div>
  )
}

// The hero screenshots: they rise in on load, the phone floats, and on a desktop pointer the
// pair tilts a little towards the mouse.
export function HeroArt() {
  const reduced = useReducedMotion()
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const spring = { stiffness: 120, damping: 18, mass: 0.6 }
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-5, 5]), spring)
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [4, -4]), spring)

  function track(event: React.PointerEvent<HTMLDivElement>) {
    if (reduced || event.pointerType !== "mouse") return
    const box = event.currentTarget.getBoundingClientRect()
    px.set((event.clientX - box.left) / box.width - 0.5)
    py.set((event.clientY - box.top) / box.height - 0.5)
  }

  function reset() {
    px.set(0)
    py.set(0)
  }

  return (
    <div className="relative pb-6 [perspective:1400px] lg:pb-0" onPointerMove={track} onPointerLeave={reset}>
      <m.div
        style={{ rotateX, rotateY }}
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.15 }}
      >
        <BrowserFrame>
          <Image
            src="/screens/home.jpg"
            alt="Pantrila's home screen with today's meals, nutrition and the assistant"
            width={1280}
            height={800}
            priority
            sizes="(min-width: 1024px) 600px, 100vw"
          />
        </BrowserFrame>
      </m.div>
      <m.div
        className="absolute -bottom-2 -left-3 w-[30%] min-w-[118px] sm:-left-8 lg:-bottom-10"
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.4 }}
      >
        <m.div
          animate={reduced ? undefined : { y: [0, -10, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
        >
          <PhoneFrame>
            <Image
              src="/screens/cooking.jpg"
              alt="Cooking mode on a phone, showing one step and a timer"
              width={390}
              height={844}
              sizes="200px"
            />
          </PhoneFrame>
        </m.div>
      </m.div>
    </div>
  )
}
