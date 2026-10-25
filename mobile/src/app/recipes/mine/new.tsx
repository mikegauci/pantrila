import { Share2 } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** Importing a recipe (from a post, a link, photos or typed in) comes in mobile plan PR 8. */
export default function NewRecipe() {
  return (
    <Soon icon={Share2} title="Importing is coming to the app">
      Paste a TikTok, Instagram or Facebook link or a recipe site, and Pantrila reads the ingredients and method.
    </Soon>
  )
}
