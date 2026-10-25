import { CalendarDays } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** The meal plan comes in mobile plan PR 6. */
export default function Plan() {
  return (
    <Soon icon={CalendarDays} title="Meal plans are coming to the app">
      {"Plan your week, swap meals and see the day's nutrition here in a coming update."}
    </Soon>
  )
}
