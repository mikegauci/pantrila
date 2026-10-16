import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/** A styled native <select>: accessible, works on mobile, no popover to manage. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        className="h-10 w-full appearance-none rounded-xl border bg-surface pr-9 pl-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  )
}
