import { BookOpen } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** A cookbook recipe page comes in mobile plan PR 8. */
export default function MyRecipe() {
  return (
    <Soon icon={BookOpen} title="Your recipe opens in the app soon">
      Saved and imported recipes, with their notes, groups and credit, will open here in a coming update.
    </Soon>
  )
}
