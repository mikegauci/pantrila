"use client"

import { X } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
} from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Step {
  path: string
  /** `data-tour` value of the element to point at; none shows a centred card. */
  anchor?: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    path: "/",
    title: "Welcome to Pantrila",
    body: "Pantrila finds recipes that suit you, plans your week and builds the shopping list. This tour takes about a minute.",
  },
  {
    path: "/",
    anchor: "ask-pantrila",
    title: "Ask anything about cooking",
    body: "Type a question or pick a starter here. The answer opens in the Assistant.",
  },
  {
    path: "/assistant",
    anchor: "chat-composer",
    title: "Chat with the Assistant",
    body: "It can search recipes, check and update your pantry, swap ingredients and scale recipes. Your chats are saved in the chat list.",
  },
  {
    path: "/recipes",
    anchor: "recipe-search",
    title: "Search 300 recipes",
    body: "Describe what you fancy in plain words, for example “quick vegan dinner”.",
  },
  {
    path: "/recipes",
    anchor: "safety-switch",
    title: "Only what suits you",
    body: "This hides recipes that clash with your allergies and diet. They are checked by fixed rules, not guesses.",
  },
  {
    path: "/recipes",
    anchor: "my-recipes",
    title: "Your own cookbook",
    body: "Your own recipes live here, next to the 300 in Pantrila.",
  },
  {
    path: "/recipes/mine/new",
    anchor: "add-recipe",
    title: "Add a recipe four ways",
    body: "From photos of a cookbook page, a link to any recipe site, a social post, or by typing it in. Pantrila works out the nutrition and allergens, makes a photo of the dish, and you can cook it step by step in cooking mode.",
  },
  {
    path: "/recipes/mine/new",
    anchor: "add-post",
    title: "Save recipes from social posts",
    body: "Paste a TikTok, Instagram or Facebook link. Pantrila reads the recipe from the caption, the creator’s recipe page or the video, and credits the creator.",
  },
  {
    // A real recipe's cooking mode as the example: no allergens, and timers in its steps.
    path: "/recipes/spanish-vegetable-paella/cook",
    anchor: "voice-mic",
    title: "Cook hands-free",
    body: "Start cooking on any recipe shows one step at a time, like this paella. Tap the mic and say “next”, “back”, “start timer” or “stop timer” when your hands are busy.",
  },
  {
    path: "/plan",
    anchor: "plan-generate",
    title: "Plan your week",
    body: "Get a week of meals that fits your targets. Every plan is checked for allergens and diet before you see it.",
  },
  {
    path: "/grocery",
    anchor: "nav-grocery",
    title: "Your grocery list",
    body: "It lists what the plan needs minus what is already in your pantry. That’s the tour: replay it any time from the account menu.",
  },
]

const doneKey = (userId: string) => `pantrila-tour-done:${userId}`
/** Browser-wide, so a guest (a new anonymous user on every sign-in) is not shown the tour again. */
const DONE_COOKIE = "pantrila-tour-done=1"
const PAD = 8
const GAP = 16
const CARD_W = 380
/** Mobile tab bar height plus the gap the docked card keeps above it (`bottom-20`). */
const TAB_BAR = 80
const FIND_MS = 2000
const AUTO_START_MS = 1200

const TourContext = createContext<{ start: () => void }>({ start: () => {} })

export const useTour = () => useContext(TourContext)

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The visible element for an anchor (hidden pages stay mounted, and the nav renders twice). */
function findVisible(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

/** First-run tour across the app's pages; starts once per user, replayable via `useTour().start`. */
export function TourProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [index, setIndex] = useState<number | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const start = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setIndex(0)
  }, [])

  const close = useCallback(() => {
    try {
      document.cookie = `${DONE_COOKIE}; path=/; max-age=31536000; samesite=lax`
      if (userId) localStorage.setItem(doneKey(userId), "1")
    } catch {
      // Storage blocked: the tour may show again, which is harmless.
    }
    setIndex(null)
    const back = returnFocus.current
    requestAnimationFrame(() => back?.focus())
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const seen = (() => {
      try {
        return document.cookie.split("; ").includes(DONE_COOKIE) || localStorage.getItem(doneKey(userId)) !== null
      } catch {
        return false
      }
    })()
    if (seen) return
    const timer = setTimeout(start, AUTO_START_MS)
    return () => clearTimeout(timer)
  }, [userId, start])

  return (
    <TourContext value={{ start }}>
      {children}
      {index !== null && (
        <TourOverlay index={index} onMove={setIndex} onClose={close} />
      )}
    </TourContext>
  )
}

interface Box { top: number; left: number; width: number; height: number }

function TourOverlay({ index, onMove, onClose }: {
  index: number
  onMove: (i: number) => void
  onClose: () => void
}) {
  const step = STEPS[index]
  const last = index === STEPS.length - 1
  const pathname = usePathname()
  const router = useRouter()
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)
  const pushed = useRef<number | null>(null)
  // `found` is the step index the lookup has settled for, so a new step starts hidden.
  const [found, setFound] = useState<{ index: number; el: HTMLElement | null } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [cardH, setCardH] = useState(220)
  const [desktop, setDesktop] = useState(true)

  const ready = found?.index === index
  const target = ready ? found.el : null

  // Go to the step's page, then wait for its anchor to show (or give up and centre the card).
  // If the person leaves the page mid-step, the card stays centred until Next or Back.
  useEffect(() => {
    const away = pathname !== step.path
    if (away && pushed.current !== index) {
      pushed.current = index
      router.push(step.path)
      return
    }
    const anchor = away ? undefined : step.anchor
    const until = performance.now() + FIND_MS
    let frame = 0
    const look = () => {
      const el = anchor ? findVisible(anchor) : null
      if (!anchor || el || performance.now() > until) {
        el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })
        setFound({ index, el })
      } else {
        frame = requestAnimationFrame(look)
      }
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [index, step, pathname, router])

  // Keep the spotlight on the anchor through scrolls, resizes and layout shifts.
  useLayoutEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const measure = () => {
      setDesktop(media.matches)
      if (!target) return setBox(null)
      const r = target.getBoundingClientRect()
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (target) observer.observe(target)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [target])

  useLayoutEffect(() => {
    if (!ready || !card.current) return
    const el = card.current
    const observer = new ResizeObserver(() => setCardH(el.offsetHeight))
    observer.observe(el)
    el.focus()
    return () => observer.disconnect()
  }, [ready, index])

  const next = useCallback(() => {
    if (last) {
      onClose()
      router.push("/")
    } else onMove(index + 1)
  }, [last, index, onMove, onClose, router])
  const back = useCallback(() => index > 0 && onMove(index - 1), [index, onMove])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") back()
      else if (e.key === "Tab" && card.current) {
        // Keep focus inside the card.
        const items = [...card.current.querySelectorAll<HTMLElement>("button:not(:disabled)")]
        if (!items.length) return
        const first = items[0]
        const end = items[items.length - 1]
        const at = document.activeElement
        if (e.shiftKey && (at === first || at === card.current)) {
          e.preventDefault()
          end.focus()
        } else if (!e.shiftKey && (at === end || !card.current.contains(at))) {
          e.preventDefault()
          first.focus()
        }
      } else return
      if (e.key !== "Tab") e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, back, onClose])

  // Next to the anchor on desktop; on mobile docked above the tab bar, or at the top when the
  // anchor sits behind that spot (the chat composer); centred when there is no anchor.
  let place: React.CSSProperties | undefined
  if (!box) place = { top: Math.max(GAP, (window.innerHeight - cardH) / 2) }
  else if (!desktop) {
    const dockTop = window.innerHeight - TAB_BAR - cardH
    if (box.top + box.height > dockTop && box.top < window.innerHeight - TAB_BAR) place = { top: 12 }
  } else {
    const width = Math.min(CARD_W, window.innerWidth - 24)
    const below = window.innerHeight - (box.top + box.height) >= box.top
    const top = below
      ? Math.min(box.top + box.height + GAP, window.innerHeight - cardH - GAP)
      : Math.max(GAP, box.top - GAP - cardH)
    const left = Math.min(Math.max(GAP, box.left), window.innerWidth - width - GAP)
    place = { top, left }
  }

  return (
    <div className="fixed inset-0 z-50">
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[20px] shadow-[0_0_0_9999px_rgb(29_42_31/0.45)] transition-all duration-300 ease-out motion-reduce:transition-none"
          style={box}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-[rgb(29_42_31/0.45)]" />
      )}
      {ready && (
        <div
          key={index}
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            "fixed grid w-[min(380px,calc(100vw-24px))] gap-3 rounded-[20px] bg-surface p-5 shadow-soft outline-none animate-in fade-in-0 duration-250",
            box && desktop ? "" : "inset-x-3 mx-auto",
            box && !desktop && !place && "bottom-20",
          )}
          style={place}
        >
          <div className="flex items-start gap-3">
            <h2 id={titleId} className="flex-1 text-[18px] font-semibold leading-[26px]">{step.title}</h2>
            <Button variant="ghost" size="icon-sm" aria-label="Skip the tour" onClick={onClose}>
              <X />
            </Button>
          </div>
          <p className="text-muted-foreground">{step.body}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">
              Step {index + 1} of {STEPS.length}
            </span>
            <span className="flex-1" />
            {!last && <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>}
            {index > 0 && <Button variant="outline" size="sm" onClick={back}>Back</Button>}
            <Button size="sm" onClick={next}>{last ? "Finish" : index === 0 ? "Start" : "Next"}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
