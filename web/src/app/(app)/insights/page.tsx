"use client"

import { ExternalLink } from "lucide-react"

import { Panel, PanelTitle, Stat } from "@/components/bits"
import { Skeleton } from "@/components/ui/skeleton"
import { EVALS } from "@/lib/evals"
import { percentile, seconds, usd } from "@/lib/format"
import { usePlan, useUsage } from "@/lib/hooks"
import type { Plan, UsageEvent } from "@/lib/types"

function DayChart({ plan }: { plan: Plan }) {
  const target = plan.targets.kcal
  const max = Math.max(target ?? 0, ...plan.days.map((d) => d.nutrition.kcal)) * 1.15 || 1
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
        <caption>Daily nutrition per person{target ? `, target ${target} kcal` : ""}</caption>
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

function KindStats({ name, events }: { name: string; events: UsageEvent[] }) {
  const ok = events.filter((e) => e.ok)
  const ms = ok.map((e) => e.latency_ms)
  const costs = ok.map((e) => e.cost_usd).filter((c): c is number => c != null)
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null
  const p50 = percentile(ms, 50)
  const p95 = percentile(ms, 95)
  return (
    <div className="grid grid-cols-2 gap-4 rounded-2xl bg-surface-muted p-4 sm:grid-cols-4">
      <Stat label={`${name}s`} value={events.length} hint={events.length - ok.length ? `${events.length - ok.length} failed` : undefined} tone="warn" />
      <Stat label="Average cost" value={usd(avg, 4)} />
      <Stat label="p50 latency" value={p50 == null ? "–" : seconds(p50)} />
      <Stat label="p95 latency" value={p95 == null ? "–" : seconds(p95)} />
    </div>
  )
}

export default function InsightsPage() {
  const { data: plan } = usePlan()
  const { data: usage, isLoading } = useUsage()
  const events = usage?.events ?? []

  return (
    <div className="grid gap-5">
      <Panel>
        <PanelTitle>Nutrition in your plan</PanelTitle>
        {plan ? <DayChart plan={plan} /> : <p className="text-muted-foreground">Plan a week to see energy and macros (protein, carbs and fat) per day.</p>}
      </Panel>

      <Panel>
        <PanelTitle>Under the hood: your usage</PanelTitle>
        {isLoading ? <Skeleton className="h-32 rounded-2xl" /> : (
          <div className="grid gap-3">
            <KindStats name="Plan" events={events.filter((e) => e.kind === "plan")} />
            <KindStats name="Chat turn" events={events.filter((e) => e.kind === "chat")} />
            {events.length > 0 && (
              <div className="overflow-x-auto">
                <table className="tabular w-full text-left text-[13px]">
                  <thead className="text-[12px] text-muted-foreground">
                    <tr><th className="py-2 font-medium">When</th><th className="font-medium">Kind</th><th className="font-medium">Model calls</th><th className="font-medium">Tokens in / out</th><th className="font-medium">Cost</th><th className="font-medium">Time</th></tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 20).map((e, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-2">{new Date(e.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td>{e.kind}{!e.ok && <span className="ml-1 text-danger">failed</span>}</td>
                        <td>{e.llm_calls} ({e.tool_calls} tools)</td>
                        <td>{e.input_tokens.toLocaleString("en-GB")} / {e.output_tokens.toLocaleString("en-GB")}</td>
                        <td>{usd(e.cost_usd)}</td>
                        <td>{seconds(e.latency_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelTitle>Offline evals</PanelTitle>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Every prompt, model or retrieval change is measured on fixed test sets before it ships.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {EVALS.map((e) => (
            <div key={e.name} className="rounded-2xl border p-4">
              <p className="font-semibold">{e.name}</p>
              <p className="mb-3 text-[12px] text-muted-foreground">{e.what}</p>
              <dl className="grid gap-1.5 text-[13px]">
                {e.metrics.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{k}</dt><dd className="tabular font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <a href={e.report} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary-text underline">
                Full report <ExternalLink className="size-3" />
              </a>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
