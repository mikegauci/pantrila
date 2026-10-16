import { Leaf } from "lucide-react"

import { cn } from "@/lib/utils"

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 font-bold text-foreground", className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Leaf className="size-5" strokeWidth={2} />
      </span>
      {!compact && <span className="text-[20px] tracking-tight">Pantrio</span>}
    </span>
  )
}
