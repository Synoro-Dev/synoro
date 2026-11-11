import { cn } from "@synoro/ui";
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

export function IconTile({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-background text-foreground inline-flex size-6 items-center justify-center rounded-md border shadow-xs",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Display type shared by every heading on the landing. */
export const display = "font-semibold tracking-[-0.035em] text-balance";

export function SectionHeading({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-reveal=""
      className={cn(
        display,
        "text-3xl leading-[1.05] sm:text-4xl md:text-[3.25rem]",
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
