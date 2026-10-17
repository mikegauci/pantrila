"use client"

import {
  BarChart3, CalendarDays, ChefHat, House, LogOut, MessageCircle, Refrigerator, ShieldCheck,
  ShoppingBasket, UserRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { useAuth } from "@/components/auth-provider"
import { Logo } from "@/components/logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { avatarFor } from "@/lib/avatar"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Home", icon: House, mobile: true },
  { href: "/recipes", label: "Recipes", icon: ChefHat, mobile: true },
  { href: "/plan", label: "Meal plan", icon: CalendarDays, mobile: true },
  { href: "/grocery", label: "Grocery list", icon: ShoppingBasket, mobile: true },
  { href: "/pantry", label: "Pantry", icon: Refrigerator, mobile: false },
  { href: "/assistant", label: "Assistant", icon: MessageCircle, mobile: true },
  { href: "/insights", label: "Insights", icon: BarChart3, mobile: false },
  { href: "/profile", label: "Profile", icon: UserRound, mobile: false },
]

function active(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col border-r bg-surface px-3 py-5 md:flex xl:w-[248px] xl:px-5">
      <Link href="/" className="mb-8 flex justify-center xl:justify-start" aria-label="Pantrio home">
        <Logo compact className="xl:hidden" />
        <Logo className="hidden xl:flex" />
      </Link>
      <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = active(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              title={label}
              className={cn(
                "relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-surface-muted hover:text-foreground xl:justify-start",
                on && "bg-primary-soft text-primary-text hover:bg-primary-soft hover:text-primary-text",
              )}
            >
              {on && <span className="absolute -left-3 h-6 w-[3px] rounded-r bg-primary xl:-left-5" />}
              <Icon className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="hidden xl:inline">{label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

function BottomTabs({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.filter((n) => n.mobile).map(({ href, label, icon: Icon }) => {
        const on = active(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground",
              on && "text-primary-text",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label.split(" ")[0]}
          </Link>
        )
      })}
    </nav>
  )
}

function UserAvatar({ userId, email, size }: { userId: string | null; email: string | null; size: "lg" | "sm" }) {
  const avatar = userId ? avatarFor(userId) : null
  return (
    <Avatar size={size} aria-hidden>
      <AvatarFallback
        className={
          avatar
            ? cn(avatar.bg, size === "lg" ? "text-[20px]" : "text-[13px]")
            : "bg-primary-soft font-semibold text-primary-text"
        }
      >
        {avatar ? avatar.emoji : (email ?? "G").charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function UserMenu({ userId, email }: { userId: string | null; email: string | null }) {
  const router = useRouter()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label="Account menu">
        <UserAvatar userId={userId} email={email} size="lg" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserAvatar userId={userId} email={email} size="sm" />
            <span className="truncate">{email ?? "Guest"}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/pantry")}>
          <Refrigerator /> Pantry
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/insights")}>
          <BarChart3 /> Insights
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await supabase().auth.signOut()
            router.replace("/login")
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const noSubscribe = () => () => {}
const todayText = () =>
  new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

/** Today's date, rendered in the browser only (the shell is prerendered without it). */
function Today() {
  return useSyncExternalStore(noSubscribe, todayText, () => "")
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { session, ready } = useAuth()

  useEffect(() => {
    if (ready && !session) router.replace("/login")
  }, [ready, session, router])

  const title = NAV.find((n) => active(pathname, n.href))?.label ?? "Pantrio"

  return (
    <div className="min-h-screen">
      <Sidebar pathname={pathname} />
      <div className="md:pl-[76px] xl:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <Link href="/" className="md:hidden" aria-label="Pantrio home">
            <Logo compact />
          </Link>
          <h1 className="text-[20px] font-bold leading-8 md:text-[24px]">{title}</h1>
          <span className="ml-auto hidden text-[12px] font-medium text-muted-foreground sm:inline">
            <Today />
          </span>
          <span className="ml-auto sm:hidden" />
          <UserMenu userId={session?.user.id ?? null} email={session?.user.email ?? null} />
        </header>
        <main className="mx-auto max-w-[1200px] px-3 py-5 pb-24 sm:px-4 md:px-8 md:py-8 md:pb-10">
          {ready && session ? children : <PageSkeleton />}
        </main>
      </div>
      <BottomTabs pathname={pathname} />
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-40 rounded-[20px] md:col-span-2" />
      <Skeleton className="h-40 rounded-[20px]" />
      <Skeleton className="h-64 rounded-[20px] md:col-span-3" />
    </div>
  )
}
