// Layout for the privacy and terms pages: a readable column with plain typography.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <header className="mb-10 space-y-2 border-b border-border pb-8">
        <h1 className="text-[36px] leading-[1.1] font-extrabold tracking-tight">{title}</h1>
        <p className="text-[14px] text-muted-foreground">Last updated {updated}</p>
      </header>
      <div className="space-y-5 text-[15px] leading-[26px] [&_a]:font-semibold [&_a]:text-primary-text [&_a]:underline [&_a]:underline-offset-4 [&_h2]:pt-6 [&_h2]:text-[21px] [&_h2]:font-bold [&_h2]:tracking-tight [&_li]:pl-1 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </article>
  )
}
