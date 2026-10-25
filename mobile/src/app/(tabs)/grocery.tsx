import { ShoppingBasket } from "lucide-react-native"

import { Soon } from "@/components/soon"

/** The grocery list comes with the meal plan in mobile plan PR 6. */
export default function Grocery() {
  return (
    <Soon icon={ShoppingBasket} title="The grocery list is coming to the app">
      What to buy for your plan, by aisle, will be here in a coming update.
    </Soon>
  )
}
