import { cn } from "@/lib"

// Screenshots sit in a plain browser window or phone outline so they read as the product.
export function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-surface shadow-lift", className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-border bg-surface-muted px-3" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-[#e6e9e0]" />
        <span className="size-2.5 rounded-full bg-[#e6e9e0]" />
        <span className="size-2.5 rounded-full bg-[#e6e9e0]" />
        <span className="ml-3 h-4 w-40 rounded-md bg-surface text-[10px] leading-4 text-muted-foreground px-2">
          app.pantrila.com
        </span>
      </div>
      <div className="[&_img]:block [&_img]:h-auto [&_img]:w-full">{children}</div>
    </div>
  )
}

export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] border-[5px] border-foreground bg-foreground shadow-lift [&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:rounded-[17px]",
        className,
      )}
    >
      {children}
    </div>
  )
}
