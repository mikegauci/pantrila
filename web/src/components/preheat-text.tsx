"use client"

import { Popover } from "@base-ui/react/popover"

import { niceFractions } from "@pantrila/core/amounts"
import { PREHEAT, preheatHint } from "@pantrila/core/cooking"
import { showTemps, type TempUnit } from "@pantrila/core/temperature"

/** A step's text with its preheat words underlined; hover, focus or tap shows the later step that names the time. */
export function PreheatText({ steps, index, unit }: { steps: string[]; index: number; unit: TempUnit }) {
  const text = showTemps(niceFractions(steps[index]), unit)
  const hint = preheatHint(steps, index)
  const m = hint ? text.match(PREHEAT) : null
  if (!hint || !m || m.index === undefined) return <>{text}</>
  const end = m.index + m[0].length
  return (
    <>
      {text.slice(0, m.index)}
      <Popover.Root>
        <Popover.Trigger openOnHover delay={100} nativeButton={false} render={<span role="button" tabIndex={0} />}
                         className="cursor-help rounded-sm underline decoration-dotted decoration-muted-foreground underline-offset-[6px] outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {m[0]}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" sideOffset={8} className="isolate z-50">
            <Popover.Popup className="max-w-[min(20rem,calc(100vw-32px))] rounded-xl bg-foreground px-3.5 py-2.5 text-[14px] leading-5 text-background shadow-lg outline-none">
              <span className="font-semibold">Shown in Step {hint.step}:</span> {showTemps(niceFractions(hint.sentence), unit)}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {text.slice(end)}
    </>
  )
}
