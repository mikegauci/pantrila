"use client"

import type { TempUnit } from "@pantrila/core/temperature"

import { cn } from "@/lib/utils"
import { useTempUnit } from "@/lib/temperature"

const UNITS: TempUnit[] = ["C", "F"]

/** °C / °F switch for the temperatures in a recipe's method. The choice is kept in this browser. */
export function TemperatureToggle({ className }: { className?: string }) {
  const [unit, setUnit] = useTempUnit()
  return (
    <div role="group" aria-label="Temperature unit" className={cn("inline-flex rounded-lg border bg-surface p-0.5", className)}>
      {UNITS.map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={unit === u}
          onClick={() => setUnit(u)}
          className={cn(
            "tabular h-7 min-w-9 rounded-md px-2 text-[13px] font-semibold transition-colors",
            unit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          °{u}
        </button>
      ))}
    </div>
  )
}
