"use client"

import { NutritionSource } from "@/components/nutrition-source"
import { CalendarDays, ChefHat, Link2, Mail, MessageCircle, ShieldCheck, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "@/components/auth-provider"
import { GoogleMark } from "@/components/google-mark"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { takeReturn } from "@/lib/return-to"
import { signInWithGoogle, supabase } from "@/lib/supabase"

const POINTS = [
  { icon: MessageCircle, text: "Ask what to cook and get recipes that suit you" },
  { icon: Link2, text: "Save recipes from TikTok, Instagram, Facebook or any recipe site" },
  { icon: ChefHat, text: "Cook step by step, hands free, with timers that start themselves" },
  { icon: CalendarDays, text: "Plan your week and get a grocery list of only what is missing" },
  { icon: ShieldCheck, text: "Allergens and diets checked by code, not by the AI's word" },
]

export default function LoginPage() {
  const router = useRouter()
  const { session, ready } = useAuth()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [busy, setBusy] = useState<"email" | "google" | "guest" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ready && session) router.replace(takeReturn())
  }, [ready, session, router])

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy("email")
    setError(null)
    const { error } = await supabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setBusy(null)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function google() {
    setBusy("google")
    setError(null)
    const message = await signInWithGoogle()
    // On success the browser is already leaving for Google, so keep the button busy.
    if (message) {
      setBusy(null)
      setError(`Google sign-in is not available: ${message}`)
    }
  }

  async function guest() {
    setBusy("guest")
    setError(null)
    const { error } = await supabase().auth.signInAnonymously()
    setBusy(null)
    if (error) setError(`Guest sign-in is not available: ${error.message}`)
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary-soft p-12 lg:flex">
        <Logo />
        <div>
          <p className="max-w-md text-[28px] font-bold leading-9">
            Your AI cooking companion, from idea to plate.
          </p>
          <ul className="mt-8 grid gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px]">
                <span className="grid size-10 place-items-center rounded-xl bg-surface">
                  <Icon className="size-5 text-primary-text" strokeWidth={1.75} aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-muted-foreground">
          <NutritionSource /> Not medical advice.
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-[28px] font-bold leading-9">Welcome to Pantrila</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Ask what to cook, save the recipes you love and get talked through every step.
          </p>

          {error && (
            <p role="alert" className="mt-6 rounded-xl bg-danger-soft p-3 text-[13px] text-danger">
              {error}
            </p>
          )}

          <Button
            size="lg"
            variant="outline"
            className="mt-8 h-12 w-full bg-white text-[15px] text-[#1f1f1f] shadow-sm hover:bg-[#f8f9fa] hover:text-[#1f1f1f] dark:bg-white dark:hover:bg-[#f1f3f4]"
            onClick={google}
            disabled={!ready || busy !== null}
          >
            <GoogleMark /> {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>
          <p className="mt-2 text-center text-[12px] text-muted-foreground">
            Keeps your pantry, plans and cookbook on any device.
          </p>

          <div className="my-6 flex items-center gap-3 text-[12px] text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <Button size="lg" variant="secondary" className="h-12 w-full text-[15px]" onClick={guest} disabled={!ready || busy !== null}>
            <UserRound /> {busy === "guest" ? "Starting…" : "Try it as a guest"}
          </Button>
          <p className="mt-2 text-center text-[12px] text-muted-foreground">
            No account needed. Add Google later to keep your data.
          </p>

          <div className="mt-8 border-t pt-6 text-[13px]">
            {sent ? (
              <div role="status">
                <Mail className="mb-2 size-5 text-primary-text" aria-hidden />
                <p>
                  Check <strong>{email}</strong> for a sign-in link and open it on this device.
                </p>
                <Button variant="link" className="mt-1 h-auto px-0" onClick={() => setSent(false)}>
                  Use another email
                </Button>
              </div>
            ) : emailOpen ? (
              <form onSubmit={sendLink} className="grid gap-2">
                <Label htmlFor="email">Sign in with email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                />
                <Button type="submit" size="lg" disabled={!ready || busy !== null}>
                  {busy === "email" ? "Sending…" : "Email me a sign-in link"}
                </Button>
              </form>
            ) : (
              <p className="text-center text-muted-foreground">
                Prefer email?{" "}
                <button type="button" className="font-medium text-primary-text underline-offset-4 hover:underline"
                        onClick={() => setEmailOpen(true)}>
                  Sign in with a link
                </button>
              </p>
            )}
          </div>
          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            By continuing you agree to the{" "}
            <a href="https://pantrila.com/terms" className="underline underline-offset-4 hover:text-foreground">Terms</a>
            {" "}and{" "}
            <a href="https://pantrila.com/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy policy</a>.
          </p>
        </div>
      </section>
    </main>
  )
}
