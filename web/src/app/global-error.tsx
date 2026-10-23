"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

// Last resort when the root layout itself fails: report it and offer a reload.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, background: "#fbfaf7", color: "#1f2a24" }}>
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p>Pantrila hit an error and has been told about it. Reload the page to carry on.</p>
        <button type="button" onClick={() => location.reload()} style={{ padding: "8px 16px", borderRadius: 8 }}>
          Reload
        </button>
      </body>
    </html>
  )
}
