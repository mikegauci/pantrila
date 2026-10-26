import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { AuthProvider } from "@/components/auth-provider"
import { Toaster } from "@/components/ui/sonner"
import { APP_STORE_ID } from "@/lib/stores"
import "./globals.css"

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Pantrila", template: "%s · Pantrila" },
  description:
    "Your AI cooking companion: ask what to cook, save recipes from TikTok, Instagram and any site, " +
    "cook hands free step by step, and plan meals that respect your allergies and targets.",
  // Safari on iPhone shows its "Open in the app / Get" banner once the App Store listing is live.
  itunes: APP_STORE_ID ? { appId: APP_STORE_ID } : null,
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-[14px] leading-[22px]">
        <AuthProvider>{children}</AuthProvider>
        <Toaster theme="light" position="top-center" />
      </body>
    </html>
  )
}
