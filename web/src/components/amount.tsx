"use client"

import { useState } from "react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { amountIn, bareName, formatAmount, unitsFor, type Measured, type ShowUnit } from "@/lib/amounts"

/** "1 1/4 tsp", or the line in another unit when one is picked. `fixed` (inside another
 * control, as in cooking mode's checklist) shows the recipe's unit with no menu. */
export function Amount({ line, scale = 1, name, fixed = false }: {
  line: Measured; scale?: number; name: string; fixed?: boolean
}) {
  const [unit, setUnit] = useState<ShowUnit>(line.unit)
  const units = fixed ? [line.unit] : unitsFor(line)
  const text = (u: ShowUnit) => `${formatAmount(amountIn(line, u, scale), u)} ${u}`
  if (units.length < 2) return <span className="tabular font-semibold">{text(unit)}</span>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${text(unit)} ${name}: show in another unit`}
        className="tabular rounded-sm font-semibold underline decoration-dotted decoration-muted-foreground underline-offset-4 hover:decoration-foreground"
      >
        {text(unit)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show in</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={unit} onValueChange={(u) => setUnit(u as ShowUnit)}>
            {units.map((u) => (
              <DropdownMenuRadioItem key={u} value={u} closeOnClick className="tabular">
                {text(u)}{u === line.unit && <span className="text-muted-foreground">(recipe)</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** An ingredient line: its amount (tap to change the unit) and its name without a repeated amount. */
export function IngredientText({ line, scale = 1, fixed = false }: {
  line: Measured & { name: string }; scale?: number; fixed?: boolean
}) {
  const name = bareName(line.name)
  return <><Amount line={line} scale={scale} name={name} fixed={fixed} /> {name}</>
}
