"use client"

import {
  BarChart3, CalendarDays, ChefHat, Compass, House, LogOut, MessageCircle, MessageSquareHeart, Refrigerator, ShoppingBasket, UserRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { avatarFor } from "@pantrila/core/avatar"

import { useAuth } from "@/components/auth-provider"
import { FeedbackSheet } from "@/components/feedback"
import { GoogleMark } from "@/components/google-mark"
import { Logo } from "@/components/logo"
import { ProBadge, ProSheet } from "@/components/pro-sheet"
import { ReplaySession } from "@/components/replay-consent"
import { TourProvider, useTour } from "@/components/tour"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { pingServer } from "@/lib/api"
import { useMe } from "@/lib/hooks"
import { googlePicture, linkGoogle, supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const NAV = [
  { key: "home", href: "/", label: "Home", icon: House, mobile: true },
  { key: "assistant", href: "/assistant", label: "Assistant", icon: MessageCircle, mobile: true },
  { key: "recipes", href: "/recipes", label: "Recipes", icon: ChefHat, mobile: true },
  { key: "plan", href: "/plan", label: "Meal plan", icon: CalendarDays, mobile: true },
  { key: "grocery", href: "/grocery", label: "Grocery list", icon: ShoppingBasket, mobile: true },
  { key: "pantry", href: "/pantry", label: "Pantry", icon: Refrigerator, mobile: false },
  { key: "insights", href: "/insights", label: "Insights", icon: BarChart3, mobile: false },
  { key: "profile", href: "/profile", label: "Profile", icon: UserRound, mobile: false },
]

function active(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col border-r bg-surface px-3 py-5 md:flex xl:w-[248px] xl:px-5">
      <Link href="/" className="mb-8 flex justify-center xl:justify-start" aria-label="Pantrila home">
        <Logo compact className="xl:hidden" />
        <Logo className="hidden xl:flex" />
      </Link>
      <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
        {NAV.map(({ key, href, label, icon: Icon }) => {
          const on = active(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              data-tour={`nav-${key}`}
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
      {NAV.filter((n) => n.mobile).map(({ key, href, label, icon: Icon }) => {
        const on = active(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            data-tour={`nav-${key}`}
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

export function UserAvatar({ userId, email, size, url, pending = false }: {
  userId: string | null
  email: string | null
  size: "lg" | "sm" | "xl"
  url?: string | null
  /** The picture is not known yet (profile still loading). */
  pending?: boolean
}) {
  const avatar = userId ? avatarFor(userId) : null
  // Base UI shows the fallback while the picture downloads; keep it blank until the
  // picture fails or there is none, so a Google photo does not flash the emoji first.
  const [failed, setFailed] = useState<string | null>(null)
  const blank = pending || (!!url && failed !== url)
  return (
    <Avatar size={size === "xl" ? undefined : size} className={size === "xl" ? "size-20" : undefined} aria-hidden>
      {url && (
        <AvatarImage
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onLoadingStatusChange={(status) => status === "error" && setFailed(url)}
        />
      )}
      <AvatarFallback
        className={
          blank
            ? "bg-surface-muted"
            : avatar
              ? cn(avatar.bg, size === "xl" ? "text-[36px]" : size === "lg" ? "text-[20px]" : "text-[13px]")
              : "bg-primary-soft font-semibold text-primary-text"
        }
      >
        {blank ? null : avatar ? avatar.emoji : (email ?? "G").charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function UserMenu({ userId, email, guest }: { userId: string | null; email: string | null; guest: boolean }) {
  const router = useRouter()
  const tour = useTour()
  const { session } = useAuth()
  const { data: me, isLoading } = useMe()
  // An uploaded picture wins; else the Google profile picture.
  const url = me?.avatar_url ?? googlePicture(session?.user)
  const pending = isLoading && !url
  const [feedback, setFeedback] = useState(false)
  return (
    <>
    <FeedbackSheet open={feedback} onClose={() => setFeedback(false)} />
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label="Account menu">
        <UserAvatar userId={userId} email={email} size="lg" url={url} pending={pending} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserAvatar userId={userId} email={email} size="sm" url={url} pending={pending} />
            <span className="truncate">{email ?? "Guest"}</span>
            {me?.subscription.tier === "pro" && <ProBadge />}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {guest && (
          <DropdownMenuItem
            onClick={async () => {
              const error = await linkGoogle()
              if (error) toast.error(`Could not add Google: ${error}`)
            }}
          >
            <GoogleMark className="size-4" /> Keep my data with Google
          </DropdownMenuItem>
        )}
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
        <DropdownMenuItem onClick={tour.start}>
          <Compass /> App tour
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setFeedback(true)}>
          <MessageSquareHeart /> Send feedback
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
    </>
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

  useEffect(pingServer, [])

  useEffect(() => {
    if (ready && !session) router.replace("/login")
  }, [ready, session, router])

  const title = NAV.find((n) => active(pathname, n.href))?.label ?? "Pantrila"

  return (
    <TourProvider userId={ready && session ? session.user.id : null}>
    <div className="min-h-screen">
      <Sidebar pathname={pathname} />
      <div className="md:pl-[76px] xl:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <Link href="/" className="md:hidden" aria-label="Pantrila home">
            <Logo compact />
          </Link>
          <h1 className="text-[20px] font-bold leading-8 md:text-[24px]">{title}</h1>
          <span className="ml-auto hidden text-[12px] font-medium text-muted-foreground sm:inline">
            <Today />
          </span>
          <span className="ml-auto sm:hidden" />
          <UserMenu userId={session?.user.id ?? null} email={session?.user.email || null} guest={!!session?.user.is_anonymous} />
        </header>
        <main className="mx-auto max-w-[1200px] px-3 py-5 pb-24 sm:px-4 md:px-8 md:py-8 md:pb-10">
          {ready && session ? children : <PageSkeleton />}
        </main>
      </div>
      <BottomTabs pathname={pathname} />
      <ReplaySession />
      <ProSheet />
    </div>
    </TourProvider>
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
