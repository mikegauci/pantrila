import type { Nutrition } from "@/lib/types"

const SEGMENTS = [
  { key: "protein_g", name: "Protein", color: "var(--primary)", kcalPerG: 4 },
  { key: "carbs_g", name: "Carbs", color: "var(--accent-yellow)", kcalPerG: 4 },
  { key: "fat_g", name: "Fat", color: "var(--accent-orange)", kcalPerG: 9 },
] as const

/** Donut of protein, carbs and fat by energy, calories in the centre. */
export function MacroRing({
  nutrition, target, size = 168,
}: { nutrition: Nutrition; target?: number | null; size?: number }) {
  const parts = SEGMENTS.map((s) => ({ ...s, kcal: nutrition[s.key] * s.kcalPerG }))
  const total = parts.reduce((a, p) => a + p.kcal, 0) || 1
  const r = 15.9155 // circumference 100
  const offsets = parts.map((_, i) => 25 - parts.slice(0, i).reduce((a, p) => a + (p.kcal / total) * 100, 0))
  const summary = SEGMENTS.map((s) => `${s.name} ${Math.round(nutrition[s.key])} g`).join(", ")
  return (
    <div className="flex flex-wrap items-center gap-5">
      <figure className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" className="size-full" role="img"
             aria-label={`${Math.round(nutrition.kcal)} kcal. ${summary}.`}>
          <circle cx="21" cy="21" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="5" />
          {parts.map((p, i) => {
            const len = Math.max(0, (p.kcal / total) * 100 - 0.8)
            return (
              <circle key={p.key} cx="21" cy="21" r={r} fill="none" stroke={p.color} strokeWidth="5"
                      strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offsets[i]} />
            )
          })}
        </svg>
        <figcaption className="absolute inset-0 grid place-content-center text-center">
          <span className="tabular text-[24px] font-bold leading-7">{Math.round(nutrition.kcal).toLocaleString("en-GB")}</span>
          <span className="text-[12px] text-muted-foreground">
            {target ? `of ${Math.round(target).toLocaleString("en-GB")} kcal` : "kcal"}
          </span>
        </figcaption>
      </figure>
      <ul className="grid gap-2 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="w-14 text-muted-foreground">{p.name}</span>
            <span className="tabular font-semibold">{Math.round(nutrition[p.key])} g</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-fibre" aria-hidden />
          <span className="w-14 text-muted-foreground">Fibre</span>
          <span className="tabular font-semibold">{Math.round(nutrition.fibre_g)} g</span>
        </li>
      </ul>
    </div>
  )
}
