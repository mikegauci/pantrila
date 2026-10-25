import { ChefHat } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** Cooking mode comes in mobile plan PR 7; the recipe page's "Start cooking" opens this. */
export default function Cook() {
  return (
    <Soon icon={ChefHat} title="Cooking mode is coming to the app">
      One step at a time, with timers that ring when the phone is locked and hands-free voice commands.
    </Soon>
  )
}
