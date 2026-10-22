import Link from "next/link"

import { Logo } from "@/components/logo"
import { APP_URL, GITHUB_URL, OPERATOR, cn } from "@/lib"

export function OpenApp({ className, children = "Open Pantrila" }: { className?: string; children?: React.ReactNode }) {
  return (
    <a
      href={APP_URL}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary-text",
        className,
      )}
    >
      {children}
    </a>
  )
}

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#safety", label: "Safety" },
  { href: "/#get", label: "Get the app" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Pantrila home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 text-[14px] font-medium text-muted-foreground md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <OpenApp className="h-10 px-4 text-[14px]" />
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs space-y-3">
          <Logo />
          <p className="text-[14px] text-muted-foreground">
            An AI cooking and meal-planning assistant. The AI suggests; rules decide.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-[14px]">
          <a href={APP_URL} className="text-muted-foreground hover:text-foreground">Open the app</a>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link>
          <Link href="/#features" className="text-muted-foreground hover:text-foreground">Features</Link>
          <Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link>
          <Link href="/#faq" className="text-muted-foreground hover:text-foreground">Questions</Link>
          <a href={GITHUB_URL} className="text-muted-foreground hover:text-foreground">Source code</a>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[13px] text-muted-foreground sm:px-6">
          © 2026 Pantrila · Made by {OPERATOR}
        </p>
      </div>
    </footer>
  )
}
