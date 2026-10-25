import { MessageCircle } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** The assistant chat comes in mobile plan PR 10; Home's Ask Pantrila card opens this tab. */
export default function Assistant() {
  return (
    <Soon icon={MessageCircle} title="The assistant is coming to the app">
      Ask about cooking, your pantry and your recipes here in a coming update.
    </Soon>
  )
}
