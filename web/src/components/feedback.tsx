"use client"

import * as Sentry from "@sentry/nextjs"
import { Loader2, MessageSquareHeart } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

export const FEEDBACK_EMAIL = "hello@pantrila.com"

/** "Send feedback": a message (and an email to reply to, if they like) sent to Sentry with the
 *  page it came from. Without Sentry set up it points at the email address instead. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth()
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const reply = email ?? session?.user.email ?? ""
  const ready = Boolean(Sentry.getClient())

  function close() {
    setMessage("")
    setEmail(null)
    onClose()
  }

  async function submit() {
    setSending(true)
    Sentry.captureFeedback({ message: message.trim(), email: reply.trim() || undefined, url: location.href },
                           { includeReplay: false })
    const sent = await Sentry.flush(5000)
    setSending(false)
    if (!sent) {
      toast.error(`Your feedback could not be sent. Try again, or email ${FEEDBACK_EMAIL}.`)
      return
    }
    toast.success("Thanks! Your feedback was sent.")
    close()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="gap-3 overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Send feedback</SheetTitle>
          <SheetDescription>
            Something broken, confusing or missing? Tell us what happened and what you expected.
          </SheetDescription>
        </SheetHeader>
        {!ready ? (
          <p className="text-[13px] text-muted-foreground">
            Feedback is not set up here. Email <a className="underline" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a> instead.
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (message.trim()) submit()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-message">Your feedback</Label>
              <Textarea id="feedback-message" required maxLength={4000} rows={6} value={message}
                        placeholder="e.g. The import got stuck on Reading the caption"
                        onChange={(e) => setMessage(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-email">Email for a reply (optional)</Label>
              <Input id="feedback-email" type="email" className="h-10" value={reply}
                     onChange={(e) => setEmail(e.target.value)} />
            </div>
            <p className="text-[12px] text-muted-foreground">
              Sent with the page you are on and your account id, so we can look into it.
            </p>
            <Button type="submit" disabled={sending || !message.trim()}>
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : <MessageSquareHeart />}
              Send feedback
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
