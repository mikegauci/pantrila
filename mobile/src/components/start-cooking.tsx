import { Link } from "expo-router"
import { ChefHat } from "lucide-react-native"
import { Pressable, Text } from "react-native"

import { Icon } from "@/components/icon"

/** The full-width "Start cooking" button that opens a recipe's cooking mode. */
export function StartCooking({ href }: { href: React.ComponentProps<typeof Link>["href"] }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary">
        <Icon icon={ChefHat} tone="primary-foreground" size={18} />
        <Text className="font-sans-semibold text-base text-primary-foreground">Start cooking</Text>
      </Pressable>
    </Link>
  )
}
