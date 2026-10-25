"use client"

import { Ruler } from "lucide-react"
import { type ReactNode, useState } from "react"

import { amountIn, bareName, formatAmount, unitsFor, type Measured, type ShowUnit } from "@pantrila/core/amounts"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * One ingredient line in the unit the person picked (the recipe's own at first): `children`
 * gets its text ("1 1/4 tsp paprika", the amount a button that opens the units) and the
 * ruler button that opens them too, for the row to put at its end where it is easy to see.
 * A line that cannot change unit (no grams, or `fixed` inside another control, as in cooking
 * mode's checklist) gets plain text and no button.
 */
export function MeasuredLine({ line, scale = 1, fixed = false, children }: {
  line: Measured & { name: string }
  scale?: number
  fixed?: boolean
  children: (text: ReactNode, picker: ReactNode) => ReactNode
}) {
  const [unit, setUnit] = useState<ShowUnit>(line.unit)
  const [open, setOpen] = useState(false)
  const name = bareName(line.name)
  const units = fixed ? [line.unit] : unitsFor(line)
  const show = (u: ShowUnit) => `${formatAmount(amountIn(line, u, scale), u)} ${u}`
  if (units.length < 2) {
    return children(<><span className="tabular font-semibold">{show(unit)}</span> {name}</>, null)
  }
  const text = (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${show(unit)} ${name}: change measurement`}
              className="tabular rounded-sm font-semibold underline decoration-dotted decoration-muted-foreground underline-offset-4 hover:decoration-foreground">
        {show(unit)}
      </button>{" "}
      {name}
    </>
  )
  const picker = (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`Change measurement for ${name}`} title="Change measurement"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0 text-muted-foreground",
                      unit !== line.unit && "text-primary-text")}
      >
        <Ruler />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show {name} in</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={unit} onValueChange={(u) => setUnit(u as ShowUnit)}>
            {units.map((u) => (
              <DropdownMenuRadioItem key={u} value={u} closeOnClick className="tabular">
                {show(u)}{u === line.unit && <span className="text-muted-foreground">(recipe)</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return children(text, picker)
}

/** An amount as plain text in the recipe's unit ("1 1/4 tsp"): cooking mode's step chips. */
export function Amount({ line, scale = 1 }: { line: Measured; scale?: number }) {
  return <span className="tabular font-semibold">{formatAmount(line.quantity * scale, line.unit)} {line.unit}</span>
}

/** An ingredient line as plain text, the unit as written: cooking mode's checklist. */
export function IngredientText({ line, scale = 1 }: { line: Measured & { name: string }; scale?: number }) {
  return <MeasuredLine line={line} scale={scale} fixed>{(text) => text}</MeasuredLine>
}
