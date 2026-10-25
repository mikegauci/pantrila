import { usePathname } from "expo-router"
import { useState } from "react"
import { Linking, Text } from "react-native"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/bits"
import { Field } from "@/components/form"
import { Sheet } from "@/components/sheet"
import { FEEDBACK_EMAIL, sendFeedback, sentryReady } from "@/lib/sentry"
import { toast } from "@/lib/toast"

/** "Send feedback": a message (and an email to reply to, if they like) sent to Sentry with the
 * screen it came from, as on the web. Without Sentry set up it points at the email address. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth()
  const screen = usePathname()
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const reply = email ?? session?.user.email ?? ""

  function close() {
    setMessage("")
    setEmail(null)
    onClose()
  }

  async function submit() {
    setSending(true)
    const sent = await sendFeedback(message.trim(), reply.trim() || undefined, screen).catch(() => false)
    setSending(false)
    if (!sent) {
      toast.error(`Your feedback could not be sent. Try again, or email ${FEEDBACK_EMAIL}.`)
      return
    }
    toast.success("Thanks! Your feedback was sent.")
    close()
  }

  return (
    <Sheet open={open} onClose={close} title="Send feedback"
           description="Something broken, confusing or missing? Tell us what happened and what you expected."
           footer={sentryReady() ? (
             <Button text={sending ? "Sending…" : "Send feedback"} busy={sending} disabled={!message.trim()} onPress={submit} />
           ) : undefined}>
      {!sentryReady() ? (
        <Text className="font-sans text-sm text-muted-foreground">
          Feedback is not set up in this build. Email{" "}
          <Text accessibilityRole="link" className="font-sans-semibold text-primary-text"
                onPress={() => Linking.openURL(`mailto:${FEEDBACK_EMAIL}`)}>{FEEDBACK_EMAIL}</Text> instead.
        </Text>
      ) : (
        <>
          <Field name="Your feedback" multiline maxLength={4000} value={message} onChangeText={setMessage}
                 placeholder="e.g. The import got stuck on Reading the caption" />
          <Field name="Email for a reply (optional)" keyboardType="email-address" autoCapitalize="none"
                 value={reply} onChangeText={setEmail} />
          <Text className="font-sans text-xs text-muted-foreground">
            Sent with the screen you are on and your account id, so we can look into it.
          </Text>
        </>
      )}
    </Sheet>
  )
}
