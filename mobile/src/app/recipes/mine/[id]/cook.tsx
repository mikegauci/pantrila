import { ChefHat } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** Cooking mode for a cookbook recipe comes in mobile plan PR 7; the plan's "Start cooking" opens this. */
export default function CookMine() {
  return (
    <Soon icon={ChefHat} title="Cooking mode is coming to the app">
      One step at a time, with timers that ring when the phone is locked and hands-free voice commands.
    </Soon>
  )
}
