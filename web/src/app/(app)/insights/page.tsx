"use client"

import { Panel, PanelTitle } from "@/components/bits"
import { usePlan } from "@/lib/hooks"
import { kcalGoal, kcalTargetText } from "@/lib/plan"
import type { Plan } from "@/lib/types"

function DayChart({ plan }: { plan: Plan }) {
  const target = kcalTargetText(plan.targets)
  const top = plan.targets.max_kcal ?? kcalGoal(plan.targets) ?? 0
  const max = Math.max(top, ...plan.days.map((d) => d.nutrition.kcal)) * 1.15 || 1
  return (
    <figure>
      <div className="flex h-48 items-end gap-2 border-b pb-px" aria-hidden>
        {plan.days.map((d) => {
          const n = d.nutrition
          const parts = [
            { v: n.protein_g * 4, c: "var(--primary)" },
            { v: n.carbs_g * 4, c: "var(--accent-yellow)" },
            { v: n.fat_g * 9, c: "var(--accent-orange)" },
          ]
          const sum = parts.reduce((a, p) => a + p.v, 0) || 1
          return (
            <div key={d.day} className="relative mx-auto flex h-full w-full max-w-20 flex-1 flex-col justify-end">
              <div className="flex flex-col-reverse overflow-hidden rounded-t-lg" style={{ height: `${(n.kcal / max) * 100}%` }}>
                {parts.map((p, i) => <div key={i} style={{ height: `${(p.v / sum) * 100}%`, background: p.c }} />)}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 pt-1 text-center text-[12px] text-muted-foreground" aria-hidden>
        {plan.days.map((d) => <span key={d.day} className="flex-1">Day {d.day}</span>)}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-[12px]">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" />Protein</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-yellow" />Carbs</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-orange" />Fat</span>
        <span className="text-muted-foreground">Bar height is energy; colours split it by macro.</span>
      </figcaption>
      <table className="sr-only">
        <caption>Daily nutrition per person{target ? `, target ${target}` : ""}</caption>
        <thead><tr><th>Day</th><th>kcal</th><th>Protein g</th><th>Carbs g</th><th>Fat g</th></tr></thead>
        <tbody>
          {plan.days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td><td>{Math.round(d.nutrition.kcal)}</td><td>{Math.round(d.nutrition.protein_g)}</td>
              <td>{Math.round(d.nutrition.carbs_g)}</td><td>{Math.round(d.nutrition.fat_g)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export default function InsightsPage() {
  const { data: plan } = usePlan()

  return (
    <div className="grid gap-5">
      <Panel>
        <PanelTitle>Nutrition in your plan</PanelTitle>
        {plan ? <DayChart plan={plan} /> : <p className="text-muted-foreground">Plan a week to see energy and macros (protein, carbs and fat) per day.</p>}
      </Panel>
    </div>
  )
}
