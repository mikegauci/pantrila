import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { SiteFooter, SiteHeader } from "@/components/chrome"
import { MotionProvider } from "@/components/motion"
import { SITE_URL } from "@/lib"
import "./globals.css"

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] })

const description =
  "Pantrila is your AI cooking companion: ask what to cook, save recipes from Instagram, TikTok, " +
  "Facebook or any site, cook hands free step by step, and plan meals around your allergies and diet."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Pantrila: your AI cooking companion", template: "%s · Pantrila" },
  description,
  openGraph: {
    type: "website",
    siteName: "Pantrila",
    url: SITE_URL,
    title: "Pantrila: your AI cooking companion",
    description,
  },
  twitter: { card: "summary_large_image" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f8f3",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans text-[15px] leading-[24px]">
        <MotionProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </MotionProvider>
      </body>
    </html>
  )
}
