import { BookOpen } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** My recipes (the cookbook) comes in mobile plan PR 8. */
export default function MyRecipes() {
  return (
    <Soon icon={BookOpen} title="My recipes are coming to the app">
      Your saved and imported recipes will open here in a coming update.
    </Soon>
  )
}
