import type { Metadata } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { AuthProvider } from "@/components/auth-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Pantrila", template: "%s · Pantrila" },
  description:
    "AI cooking and meal-planning assistant: recipes from your pantry, a week of meals that " +
    "respects your allergies and targets, and a grocery list.",
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
