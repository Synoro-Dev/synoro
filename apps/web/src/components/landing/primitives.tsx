import { cn } from "@acme/ui";
import type { LucideIcon } from "lucide-react";

/** Centered content column whose side borders draw the page "rails". */
export function Container({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative mx-auto w-full max-w-6xl sm:border-x", className)}
      {...props}
    />
  );
}

/** Small "+" where a section divider crosses a rail. */
function Cross({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 11 11"
      className={cn(
        "text-foreground/25 absolute z-10 hidden size-[11px] sm:block",
        className,
      )}
    >
      <path d="M5.5 0v11M0 5.5h11" stroke="currentColor" />
    </svg>
  );
}

/** Full-width band between top dividers, with rails and corner marks. */
export function Section({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & { containerClassName?: string }) {
  return (
    <section className={cn("border-t", className)} {...props}>
      <Container className={containerClassName}>
        <Cross className="-top-[6px] -left-[6px]" />
        <Cross className="-top-[6px] -right-[6px]" />
        {children}
      </Container>
    </section>
  );
}

const tones = {
  violet: "bg-violet-500/10 text-violet-600 ring-violet-500/20",
  emerald: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  sky: "bg-sky-500/10 text-sky-600 ring-sky-500/20",
  rose: "bg-rose-500/10 text-rose-600 ring-rose-500/20",
} as const;

export type Tone = keyof typeof tones;

export function IconTile({
  icon: Icon,
  tone,
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

export function Eyebrow({
  icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
      <IconTile icon={icon} tone={tone} />
      {children}
    </div>
  );
}

export function SectionHeading({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-3xl font-medium tracking-tight text-balance sm:text-4xl md:text-5xl",
        className,
      )}
      {...props}
    />
  );
}

export function Lead({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-muted-foreground max-w-xl text-base text-pretty sm:text-lg",
        className,
      )}
      {...props}
    />
  );
}

/** Initials avatar with a soft gradient; mockups use it instead of photos. */
export function Initials({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-zinc-100 to-zinc-200 text-xs font-medium text-zinc-700 ring-1 ring-black/5",
        className,
      )}
    >
      {initials}
    </span>
  );
}
