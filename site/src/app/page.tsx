import Image from "next/image"
import {
  CalendarDays,
  ChefHat,
  Globe,
  Link2,
  ListChecks,
  MessageCircle,
  ScanSearch,
  ShieldCheck,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Wheat,
} from "lucide-react"

import { OpenApp } from "@/components/chrome"
import { BrowserFrame, PhoneFrame } from "@/components/frames"
import { APP_URL, GITHUB_URL } from "@/lib"

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
    title: "Cooking mode",
    text: "One step at a time, with timers taken from the recipe and the screen kept awake. Say “next” or “start timer” when your hands are messy.",
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
    image: { src: "/screens/plan.jpg", alt: "A week's meal plan in Pantrila with daily energy and protein bars", width: 1280, height: 800 },
  },
  {
    eyebrow: "Ask",
    title: "A cooking assistant that knows your kitchen",
    text: "“What can I make with chickpeas and spinach?” Pantrila answers from its recipe library and your pantry, and adds items to your pantry when you tell it what you bought.",
    points: ["Cites the recipes it recommends", "Warns you when something breaks your rules", "Writes new recipes you can save to your cookbook"],
    image: { src: "/screens/assistant.jpg", alt: "A conversation with the Pantrila assistant recommending recipes", width: 1280, height: 800 },
  },
  {
    eyebrow: "Save",
    title: "That recipe you saw on Instagram, in your cookbook",
    text: "Paste the post link. Pantrila reads the caption, follows the creator’s link or listens to the video, then turns it into a recipe with amounts, steps and nutrition.",
    points: ["Links, photos, posts or typed in", "Keeps the creator’s notes and credit", "Allergens checked like every other recipe"],
    image: { src: "/screens/recipe.jpg", alt: "A recipe in Pantrila with its photo, allergens, ingredients and nutrition", width: 1280, height: 800 },
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
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_70%_20%,var(--primary-soft),transparent_70%),radial-gradient(40%_40%_at_15%_30%,var(--accent-yellow-soft),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-surface px-3 py-1 text-[13px] font-semibold text-primary-text">
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI cooking and meal planning
          </span>
          <h1 className="text-[40px] leading-[1.08] font-extrabold tracking-tight text-balance sm:text-[52px]">
            Cook from what you have. Eat what suits you.
          </h1>
          <p className="max-w-xl text-[17px] leading-[28px] text-muted-foreground text-pretty">
            Tell Pantrila what is in your kitchen, how you eat and what you can’t. It finds recipes, plans your week,
            writes the grocery list and talks you through the cooking, and checks every meal against your allergies.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <OpenApp className="h-12 px-6 text-[16px]">Open Pantrila, it’s free</OpenApp>
            <a
              href="#features"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-surface px-6 font-semibold transition-colors hover:bg-surface-muted"
            >
              See what it does
            </a>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Works in any browser. Continue with Google or try it as a guest, no sign-up needed.
          </p>
        </div>
        <div className="relative pb-6 lg:pb-0">
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
          <PhoneFrame className="absolute -bottom-2 -left-3 w-[30%] min-w-[118px] sm:-left-8 lg:-bottom-10">
            <Image
              src="/screens/cooking.jpg"
              alt="Cooking mode on a phone, showing one step and a timer"
              width={390}
              height={844}
              sizes="200px"
            />
          </PhoneFrame>
        </div>
      </div>
    </section>
  )
}

function Facts() {
  const facts = [
    ["14", "EU allergens checked on every recipe"],
    ["300", "recipes with nutrition worked out per ingredient"],
    ["7 days", "of meals planned in under a minute"],
  ]
  return (
    <section aria-label="Pantrila in numbers" className="border-y border-border bg-surface">
      <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
        {facts.map(([value, label]) => (
          <div key={label} className="flex items-baseline gap-3 sm:block">
            <dt className="text-[28px] font-extrabold tracking-tight text-primary-text">{value}</dt>
            <dd className="text-[14px] text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 text-center">
      <p className="text-[13px] font-semibold tracking-wide text-primary-text uppercase">{eyebrow}</p>
      <h2 className="text-[30px] leading-[1.15] font-extrabold tracking-tight text-balance sm:text-[38px]">{title}</h2>
      {text && <p className="text-[16px] text-muted-foreground text-pretty">{text}</p>}
    </div>
  )
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Everything between “what’s for dinner?” and dinner"
          text="From the first idea to the last step at the stove, in one place."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl border border-border bg-surface p-6 shadow-soft">
              <span className="mb-4 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-text">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mb-1.5 text-[17px] font-bold">{title}</h3>
              <p className="text-[14px] leading-[22px] text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Showcase() {
  return (
    <section aria-label="Pantrila up close" className="space-y-20 pb-20">
      {SHOWCASE.map((item, i) => (
        <div
          key={item.title}
          className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14"
        >
          <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
            <BrowserFrame>
              <Image {...item.image} alt={item.image.alt} sizes="(min-width: 1024px) 540px, 100vw" />
            </BrowserFrame>
          </div>
          <div className="space-y-4">
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
          </div>
        </div>
      ))}
    </section>
  )
}

function Safety() {
  return (
    <section id="safety" className="scroll-mt-16 bg-primary-deep py-20 text-white">
      <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-[13px] font-semibold tracking-wide text-[#a8e0b0] uppercase">Safety</p>
          <h2 className="text-[30px] leading-[1.15] font-extrabold tracking-tight text-balance sm:text-[38px]">
            The AI suggests. Rules decide.
          </h2>
          <p className="text-[16px] text-white/75 text-pretty">
            An allergy is not something to leave to a language model. Pantrila checks food rules in plain code that
            gives the same answer every time.
          </p>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {SAFETY.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl bg-white/[0.07] p-6 ring-1 ring-white/10">
              <Icon className="mb-4 size-6 text-[#a8e0b0]" aria-hidden="true" />
              <h3 className="mb-1.5 text-[17px] font-bold">{title}</h3>
              <p className="text-[14px] leading-[22px] text-white/75">{text}</p>
            </li>
          ))}
        </ul>
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
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col justify-between gap-6 rounded-2xl bg-primary p-7 text-primary-foreground shadow-lift">
            <div className="space-y-2">
              <Globe className="size-7" aria-hidden="true" />
              <h3 className="text-[22px] font-extrabold">In your browser</h3>
              <p className="text-[14px] text-white/85">
                Chrome, Safari, Firefox or Edge, on any device. Sign in with Google or try it as a guest.
              </p>
            </div>
            <a
              href={APP_URL}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 font-semibold text-primary-text transition-colors hover:bg-primary-soft"
            >
              Open app.pantrila.com
            </a>
          </div>
          <StoreCard store="App Store" device="iPhone and iPad" />
          <StoreCard store="Google Play" device="Android phones and tablets" />
        </div>
      </div>
    </section>
  )
}

function StoreCard({ store, device }: { store: string; device: string }) {
  return (
    <div className="flex flex-col justify-between gap-6 rounded-2xl border border-dashed border-border bg-surface p-7">
      <div className="space-y-2">
        <Smartphone className="size-7 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[19px] font-bold">{store}</h3>
        <p className="text-[14px] text-muted-foreground">For {device}.</p>
      </div>
      <span className="inline-flex h-12 items-center justify-center rounded-xl bg-surface-muted px-6 text-[14px] font-semibold text-muted-foreground">
        Coming soon
      </span>
    </div>
  )
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 border-t border-border bg-surface py-20">
      <div className="mx-auto max-w-3xl space-y-10 px-4 sm:px-6">
        <SectionHeading eyebrow="Questions" title="Good to know" />
        <div className="divide-y divide-border rounded-2xl border border-border">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pt-3 text-[14px] leading-[22px] text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
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
