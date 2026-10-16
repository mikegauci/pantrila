"use client"

import { CalendarDays, ChefHat, Mail, ShieldCheck, ShoppingBasket, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "@/components/auth-provider"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"

const POINTS = [
  { icon: ChefHat, text: "Find recipes from what is already in your kitchen" },
  { icon: CalendarDays, text: "Plan a week of meals around your diet and nutrition targets" },
  { icon: ShoppingBasket, text: "Get a grocery list of only what is missing" },
  { icon: ShieldCheck, text: "Allergens and diets are checked by code, not by the AI's word" },
]

export default function LoginPage() {
  const router = useRouter()
  const { session, ready } = useAuth()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState<"email" | "guest" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ready && session) router.replace("/")
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
            Your kitchen, your diet, a week of meals that fits both.
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
          Nutrition values from USDA FoodData Central. Not medical advice.
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-[24px] font-bold leading-8">Try Pantrio</h1>
          <p className="mt-1 text-muted-foreground">
            No account needed. Set your diet and allergies, add what is in your kitchen and plan
            a week.
          </p>
          <Button size="lg" className="mt-8 w-full" onClick={guest} disabled={busy !== null}>
            <UserRound /> {busy === "guest" ? "Starting…" : "Try it as a guest"}
          </Button>
          <p className="mt-2 text-center text-[12px] text-muted-foreground">
            Your guest data stays with this browser session.
          </p>

          <details className="mt-10 rounded-[20px] border bg-surface p-4 text-[13px]">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Sign in with email (owner only)
            </summary>
            {sent ? (
              <div className="mt-3">
                <Mail className="mb-2 size-5 text-primary-text" aria-hidden />
                <p>
                  If <strong>{email}</strong> can receive Pantrio email, a link is on its way. Open
                  it on this device.
                </p>
                <Button variant="link" className="mt-1 px-0" onClick={() => setSent(false)}>
                  Use another email
                </Button>
              </div>
            ) : (
              <form onSubmit={sendLink} className="mt-3 grid gap-2">
                <p className="text-muted-foreground">
                  The demo only emails sign-in links to its owner. Everyone else: use the guest
                  button above.
                </p>
                <Label htmlFor="email" className="sr-only">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                />
                <Button type="submit" variant="outline" disabled={busy !== null}>
                  {busy === "email" ? "Sending…" : "Email me a sign-in link"}
                </Button>
              </form>
            )}
          </details>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-danger-soft p-3 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
