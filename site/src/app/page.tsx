import Image from "next/image"
import {
  ArrowRight,
  CalendarDays,
  ChefHat,
  Globe,
  Link2,
  ListChecks,
  MessageCircle,
  Plus,
  ScanSearch,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Wheat,
} from "lucide-react"

import { AllergenCheck } from "@/components/allergen-check"
import { OpenApp } from "@/components/chrome"
import { AskDemo, CookDemo, PlanDemo, SaveDemo } from "@/components/demos"
import { BrowserFrame, PhoneFrame } from "@/components/frames"
import { FlipWord } from "@/components/flip-word"
import { HeroArt, HeroGlow } from "@/components/hero-art"
import { CountUp, Reveal, StaggerItem, StaggerList } from "@/components/motion"
import { APP_URL, GITHUB_URL, cn } from "@/lib"

const FEATURES = [
  {
    icon: MessageCircle,
    title: "Ask Pantrila",
    text: "Ask anything about cooking. It searches recipes, checks your pantry, swaps an ingredient or scales a recipe, and every recipe it suggests is checked against your rules.",
  },
  {
    icon: CalendarDays,
    title: "A week of meals",
    text: "Breakfast, lunch and dinner for up to seven days, fitted to your calories and protein. Swap a meal, eat out, skip one or cook once and eat the leftovers.",
  },
  {
    icon: Link2,
    title: "Save recipes from anywhere",
    text: "Paste a recipe link or an Instagram, TikTok or Facebook post, or snap a cookbook page. Pantrila reads the ingredients and method and credits the creator.",
  },
  {
    icon: ChefHat,
    title: "Cooking mode, hands free",
    text: "One step at a time, with timers taken from the recipe and the screen kept awake. Turn on the mic and say “next”, “back” or “start timer” when your hands are in the bowl.",
    highlight: true,
  },
  {
    icon: ShoppingBasket,
    title: "Pantry and grocery list",
    text: "Keep track of what you have. The grocery list holds only what is missing, sorted by aisle and rounded to amounts you can actually buy.",
  },
  {
    icon: Wheat,
    title: "Nutrition worked out, not guessed",
    text: "Calories and macros (protein, carbs and fat) come from each ingredient’s weight and public food data from USDA and the French Ciqual tables.",
  },
]

const SHOWCASE = [
  {
    eyebrow: "Plan",
    title: "Your week, planned in under a minute",
    text: "Tell Pantrila your diet, allergies and targets once. It drafts a week from recipes that fit, uses what is already in your pantry first, and shows how each day lands on energy and protein.",
    points: ["Set one calorie number or a range", "Swap any meal from recipes that suit you", "Repeat a meal on other days as leftovers"],
    demo: PlanDemo,
    image: { src: "/screens/plan.jpg", alt: "A week's meal plan in Pantrila with daily energy and protein bars", width: 1280, height: 800 },
  },
  {
    eyebrow: "Ask",
    title: "A cooking assistant that knows your kitchen",
    text: "“What can I make with chickpeas and spinach?” Pantrila answers from its recipe library and your pantry, and adds items to your pantry when you tell it what you bought.",
    points: ["Cites the recipes it recommends", "Warns you when something breaks your rules", "Writes new recipes you can save to your cookbook"],
    demo: AskDemo,
    image: { src: "/screens/assistant.jpg", alt: "A conversation with the Pantrila assistant recommending recipes", width: 1280, height: 800 },
  },
  {
    eyebrow: "Save",
    title: (
      <>
        That recipe you saw on{" "}
        <span className="whitespace-nowrap">
          <FlipWord words={["Instagram", "Facebook", "TikTok"]} />,
        </span>{" "}
        in your cookbook
      </>
    ),
    text: "Paste the post link. Pantrila reads the caption, follows the creator’s link or listens to the video, then turns it into a recipe with amounts, steps and nutrition.",
    points: ["Links, photos, posts or typed in", "Keeps the creator’s notes and credit", "Allergens checked like every other recipe"],
    demo: SaveDemo,
    image: { src: "/screens/recipe.jpg", alt: "A recipe in Pantrila with its photo, allergens, ingredients and nutrition", width: 1280, height: 800 },
  },
  {
    eyebrow: "Cook",
    title: "Cooking mode that listens, so your hands stay busy",
    text: "Open a recipe and start cooking. Pantrila shows one step at a time, starts the timers the method asks for and keeps the screen awake. Turn on the mic and it follows your voice.",
    points: ["Say “next”, “back”, “start timer” or “stop timer”", "A chime and a short label confirm each command", "Keeps your place if the screen locks, and the mic picks up again when you return"],
    demo: CookDemo,
    image: { src: "/screens/cooking.jpg", alt: "Cooking mode on a phone, showing one step and a timer", width: 390, height: 844 },
    phone: true,
  },
]

const SAFETY = [
  {
    icon: ScanSearch,
    title: "Allergens from the ingredients",
    text: "Each recipe’s allergens and diets are worked out in code from its ingredients, covering the 14 allergens EU food law requires labels for.",
  },
  {
    icon: ListChecks,
    title: "Checked before and after",
    text: "Your rules filter the recipes before the AI sees any of them, and the finished plan is checked again, meal by meal.",
  },
  {
    icon: ShieldCheck,
    title: "Never shown if it breaks a rule",
    text: "A meal that breaks one of your rules is repaired or replaced before you see the plan. The AI suggests; rules decide.",
  },
]

const FAQ = [
  {
    q: "Is Pantrila free?",
    a: "Yes. Pantrila is free to use in your browser. Each account has a daily allowance of AI plans, chats, imports and photos.",
  },
  {
    q: "Do I need an account?",
    a: "No. Try it as a guest straight away. Continue with Google, or add Google later from your profile, to keep your data across devices.",
  },
  {
    q: "Which allergies and diets does it handle?",
    a: "The 14 allergens EU law requires labels for (including gluten, milk, eggs, peanuts, tree nuts, soy, fish, shellfish and sesame), plus vegetarian, vegan, gluten-free and other diets, and any food you choose to avoid. Always check product labels yourself if an allergy is serious.",
  },
  {
    q: "Is there a phone app?",
    a: "Pantrila works in the browser on your phone today, including cooking mode and voice commands. Apps for iPhone and Android are on the way.",
  },
  {
    q: "Does cooking mode work hands free?",
    a: "Yes. Turn on the mic in cooking mode and say “next”, “back”, “start timer” or “stop timer”. Your browser sends the speech to Google or Apple to turn it into words, the mic stops when the page is hidden, and the buttons still work if your browser has no speech recognition.",
  },
]

export default function Home() {
  return (
    <>
      <Hero />
      <Facts />
      <Features />
      <Showcase />
      <Safety />
      <GetTheApp />
      <Faq />
    </>
  )
}

function Hero() {
  // Pulled up under the clear header so the glow runs to the top of the page.
  return (
    <section className="relative -mt-16 overflow-hidden pt-16">
      <HeroGlow />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
        <div className="space-y-6">
          <Reveal>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-surface px-3 py-1 text-[13px] font-semibold text-primary-text">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI cooking and meal planning
            </span>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="text-[40px] leading-[1.08] font-extrabold tracking-tight text-balance sm:text-[52px]">
              Cook from what you have. Eat what suits you.
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="max-w-xl text-[17px] leading-[28px] text-muted-foreground text-pretty">
              Tell Pantrila what is in your kitchen, how you eat and what you can’t. It finds recipes, plans your week,
              writes the grocery list and talks you through the cooking, hands free if you like, and checks every meal
              against your allergies.
            </p>
          </Reveal>
          <Reveal delay={0.24} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <OpenApp className="h-12 px-6 text-[16px]">
              Open Pantrila, it’s free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </OpenApp>
            <a
              href="#features"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-surface px-6 font-semibold transition-[background-color,transform] hover:bg-surface-muted active:scale-[0.97]"
            >
              See what it does
            </a>
          </Reveal>
          <Reveal delay={0.32}>
            <p className="text-[13px] text-muted-foreground">
              Works in any browser. Continue with Google or try it as a guest, no sign-up needed.
            </p>
          </Reveal>
        </div>
        <HeroArt />
      </div>
    </section>
  )
}

function Facts() {
  const facts = [
    { value: 14, label: "EU allergens checked on every recipe" },
    { value: 300, label: "recipes with nutrition worked out per ingredient" },
    { value: 7, suffix: " days", label: "of meals planned in under a minute" },
  ]
  return (
    <section aria-label="Pantrila in numbers" className="border-y border-border bg-surface">
      <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
        {facts.map(({ value, suffix, label }) => (
          <div key={label} className="flex items-baseline gap-3 sm:block">
            <dt className="text-[28px] font-extrabold tracking-tight text-primary-text">
              <CountUp value={value} suffix={suffix} />
            </dt>
            <dd className="text-[14px] text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
      <p className="text-[13px] font-semibold tracking-wide text-primary-text uppercase">{eyebrow}</p>
      <h2 className="text-[30px] leading-[1.15] font-extrabold tracking-tight text-balance sm:text-[38px]">{title}</h2>
      {text && <p className="text-[16px] text-muted-foreground text-pretty">{text}</p>}
    </Reveal>
  )
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Everything you need, from planning to plate"
          text="From the first idea to the last step at the stove, in one place."
        />
        <StaggerList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text, highlight }) => (
            <StaggerItem
              key={title}
              className={cn(
                "group rounded-2xl border bg-surface p-6 shadow-soft transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lift",
                highlight ? "border-primary ring-4 ring-primary/15" : "border-border",
              )}
            >
              <span className="mb-4 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-text transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mb-1.5 flex flex-wrap items-center gap-2 text-[17px] font-bold">
                {title}
                {highlight && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tracking-wide text-primary-foreground uppercase">
                    Voice
                  </span>
                )}
              </h3>
              <p className="text-[14px] leading-[22px] text-muted-foreground">{text}</p>
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </section>
  )
}

function Showcase() {
  return (
    <section aria-label="Pantrila up close" className="space-y-20 pb-20">
      {SHOWCASE.map(({ demo: Demo, ...item }, i) => (
        <div
          key={item.eyebrow}
          className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14"
        >
          <Reveal x={i % 2 === 1 ? 40 : -40} y={0} className={cn("pb-8", i % 2 === 1 && "lg:order-2")}>
            {item.phone ? (
              <div className="relative mx-auto w-fit">
                <PhoneFrame className="w-[240px] sm:w-[260px]">
                  <Image {...item.image} alt={item.image.alt} sizes="260px" />
                </PhoneFrame>
                <Demo className="absolute bottom-10 -left-12 origin-bottom-left scale-90 sm:-left-36 sm:scale-100" />
              </div>
            ) : (
              <div className="relative">
                <BrowserFrame>
                  <Image {...item.image} alt={item.image.alt} sizes="(min-width: 1024px) 540px, 100vw" />
                </BrowserFrame>
                <Demo
                  className={cn(
                    "absolute -bottom-8 scale-90 sm:scale-100",
                    i % 2 === 1 ? "left-3 origin-bottom-left sm:-left-6" : "right-3 origin-bottom-right sm:-right-6",
                  )}
                />
              </div>
            )}
          </Reveal>
          <Reveal className="space-y-4" delay={0.1}>
            <p className="text-[13px] font-semibold tracking-wide text-primary-text uppercase">{item.eyebrow}</p>
            <h2 className="text-[28px] leading-[1.15] font-extrabold tracking-tight text-balance sm:text-[34px]">
              {item.title}
            </h2>
            <p className="text-[16px] text-muted-foreground text-pretty">{item.text}</p>
            <ul className="space-y-2 pt-1">
              {item.points.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-[15px]">
                  <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
                      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      ))}
    </section>
  )
}

function Safety() {
  return (
    <section id="safety" className="scroll-mt-16 bg-primary-deep py-20 text-white">
      <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-[13px] font-semibold tracking-wide text-[#a8e0b0] uppercase">Safety</p>
          <h2 className="text-[30px] leading-[1.15] font-extrabold tracking-tight text-balance sm:text-[38px]">
            The AI suggests. Rules decide.
          </h2>
          <p className="text-[16px] text-white/75 text-pretty">
            An allergy is not something to leave to a language model. Pantrila checks food rules in plain code that
            gives the same answer every time.
          </p>
        </Reveal>
        <AllergenCheck />
        <StaggerList className="grid gap-4 md:grid-cols-3">
          {SAFETY.map(({ icon: Icon, title, text }) => (
            <StaggerItem key={title} className="rounded-2xl bg-white/[0.07] p-6 ring-1 ring-white/10">
              <Icon className="mb-4 size-6 text-[#a8e0b0]" aria-hidden="true" />
              <h3 className="mb-1.5 text-[17px] font-bold">{title}</h3>
              <p className="text-[14px] leading-[22px] text-white/75">{text}</p>
            </StaggerItem>
          ))}
        </StaggerList>
        <p className="text-center text-[13px] text-white/60">
          Pantrila is not medical advice. If an allergy is serious, check ingredients and labels yourself too.
        </p>
      </div>
    </section>
  )
}

function GetTheApp() {
  return (
    <section id="get" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
        <SectionHeading
          eyebrow="Get the app"
          title="Start cooking in your browser today"
          text="Pantrila runs on your phone, tablet or computer, with nothing to install. Phone apps are coming."
        />
        <StaggerList className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr]">
          <StaggerItem className="flex flex-col justify-between gap-6 rounded-2xl bg-primary p-7 text-primary-foreground shadow-lift">
            <div className="space-y-2">
              <Globe className="size-7" aria-hidden="true" />
              <h3 className="text-[22px] font-extrabold">In your browser</h3>
              <p className="text-[14px] text-white/85">
                Chrome, Safari, Firefox or Edge, on any device. Sign in with Google or try it as a guest.
              </p>
            </div>
            <a
              href={APP_URL}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 font-semibold text-primary-text transition-[background-color,transform] hover:bg-primary-soft active:scale-[0.97]"
            >
              Open app.pantrila.com
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </a>
          </StaggerItem>
          <StoreCard store="App Store" device="iPhone and iPad" icon={AppleLogo} />
          <StoreCard store="Google Play" device="Android phones and tablets" icon={GooglePlayLogo} />
        </StaggerList>
      </div>
    </section>
  )
}

// Store marks from Simple Icons (simpleicons.org, CC0), drawn in the muted text colour.
function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}

function GooglePlayLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" />
    </svg>
  )
}

function StoreCard({
  store,
  device,
  icon: Icon,
}: {
  store: string
  device: string
  icon: (props: { className?: string }) => React.ReactNode
}) {
  return (
    <StaggerItem className="flex flex-col justify-between gap-6 rounded-2xl border border-dashed border-border bg-surface p-7">
      <div className="space-y-2">
        <Icon className="size-7 text-muted-foreground" />
        <h3 className="text-[19px] font-bold">{store}</h3>
        <p className="text-[14px] text-muted-foreground">For {device}.</p>
      </div>
      <span className="inline-flex h-12 items-center justify-center rounded-xl bg-surface-muted px-6 text-[14px] font-semibold text-muted-foreground">
        Coming soon
      </span>
    </StaggerItem>
  )
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 border-t border-border bg-surface py-20">
      <div className="mx-auto max-w-3xl space-y-10 px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Good to know" />
        <Reveal className="divide-y divide-border rounded-2xl border border-border">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="faq group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-muted-foreground transition-transform group-open:rotate-45"
                >
                  <Plus className="size-3.5" strokeWidth={2.5} />
                </span>
              </summary>
              <p className="pt-3 text-[14px] leading-[22px] text-muted-foreground">{a}</p>
            </details>
          ))}
        </Reveal>
        <p className="text-center text-[14px] text-muted-foreground">
          Curious how it is built? The code, evaluations and design notes are{" "}
          <a href={GITHUB_URL} className="font-semibold text-primary-text underline underline-offset-4">
            on GitHub
          </a>
          .
        </p>
      </div>
    </section>
  )
}
