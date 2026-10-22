import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { SiteFooter, SiteHeader } from "@/components/chrome"
import { SITE_URL } from "@/lib"
import "./globals.css"

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] })

const description =
  "Pantrila finds recipes from what is in your kitchen, plans a week of meals that respects " +
  "your allergies, diet and nutrition targets, writes the grocery list and talks you through the cooking."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Pantrila: AI cooking and meal planning", template: "%s · Pantrila" },
  description,
  openGraph: {
    type: "website",
    siteName: "Pantrila",
    url: SITE_URL,
    title: "Pantrila: AI cooking and meal planning",
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
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
