import { Trash2 } from "lucide-react-native"
import { useState } from "react"
import { Text, View } from "react-native"

import { useAuth } from "@/components/auth-provider"
import { Button, Panel, PanelTitle } from "@/components/bits"
import { Field } from "@/components/form"
import { ApiError, send } from "@/lib/api"
import { forgetLocal } from "@/lib/auth"
import { forgetIntro } from "@/lib/intro"
import { supabase } from "@/lib/supabase"
import { toast } from "@/lib/toast"

/** "Delete account" (Apple requires it in the app): type "delete", then `DELETE /me` removes
 * everything on the server at once; the phone forgets what it kept and signs out. */
export function DeleteAccount() {
  const user = useAuth().session?.user
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const confirmed = typed.trim().toLowerCase() === "delete"

  async function remove() {
    if (!user) return
    setBusy(true)
    try {
      await send("/me", "DELETE")
    } catch (e) {
      setBusy(false)
      toast.error(e instanceof ApiError ? e.message : "Your account could not be deleted. Try again.")
      return
    }
    await forgetLocal(user.id)
    await forgetIntro(user.id)
    await supabase().auth.signOut({ scope: "local" })  // the sign-in is already gone on the server
    toast.success("Your account and everything in it are deleted.")
  }

  return (
    <Panel>
      <PanelTitle>Delete account</PanelTitle>
      <Text className="mb-3 font-sans text-sm text-muted-foreground">
        Deletes your profile, pantry, meal plans, chats, cookbook recipes and their photos, your picture and your
        sign-in, straight away. This cannot be undone.
      </Text>
      <Text className="mb-4 font-sans text-xs text-muted-foreground">
        Have Pantrila Pro from the App Store or Google Play? Deleting your account does not stop the subscription:
        cancel it in your phone&apos;s settings first.
      </Text>
      {!open ? (
        <Button text="Delete my account" icon={Trash2} variant="outline" onPress={() => setOpen(true)} />
      ) : (
        <View className="gap-3">
          <Field name="Type delete to confirm" autoCapitalize="none" autoCorrect={false} value={typed} onChangeText={setTyped} />
          <Button text={busy ? "Deleting…" : "Delete everything"} icon={Trash2} busy={busy} disabled={!confirmed}
                  variant="danger" onPress={remove} />
          <Button text="Keep my account" variant="outline" disabled={busy} onPress={() => { setOpen(false); setTyped("") }} />
        </View>
      )}
    </Panel>
  )
}
