import { Suspense } from "react"

import { AppShell, PageSkeleton } from "@/components/app-shell"

// Pages are client-rendered behind sign-in, so there is no instant static shell to validate.
export const instant = false

export default function AppLayout({ children }: LayoutProps<"/">) {
  // The shell reads the URL and the browser session, so it streams in after the static shell.
  return (
    <Suspense fallback={<div className="p-8"><PageSkeleton /></div>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  )
}
