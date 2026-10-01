/**
 * Brand primitives rebuilt from the Nosso After flyers (docs/BRAND.md).
 * They are typographic reconstructions — replace <LogoLockup> internals with the official vector
 * logo (SVG) as soon as the brand provides it; the API stays the same.
 */
import { BRAND, flyerDate, flyerTime, flyerWeekday } from "@/lib/brand";

type LockupSize = "sm" | "md" | "lg" | "xl";
const LOCKUP_SIZE: Record<LockupSize, string> = {
  sm: "text-[2rem]",
  md: "text-[3.25rem]",
  lg: "text-[4.5rem] sm:text-[5.5rem]",
  xl: "text-[5rem] sm:text-[8rem] lg:text-[10rem]",
};

/**
 * "NOSSO / AFTER" lockup as it appears on every flyer: white NOSSO on the frame's top edge,
 * heavy AFTER in the edition color over a yellow paint stroke, worn texture, tagline on the
 * bottom edge. Colors follow --color-edition, like the flyers recolor AFTER per party.
 */
export function LogoLockup({
  size = "md",
  tagline = "festas",
  className = "",
}: {
  size?: LockupSize;
  tagline?: "festas" | "claim" | "none";
  className?: string;
}) {
  const line = tagline === "festas" ? BRAND.tagline : tagline === "claim" ? BRAND.claim : null;
  return (
    <span
      role="img"
      aria-label={`Nosso After${line ? ` — ${line}` : ""}`}
      className={`relative inline-flex flex-col items-center px-[0.22em] pb-[0.22em] pt-[0.36em] leading-none ${LOCKUP_SIZE[size]} ${className}`}
    >
      {/* the white box that frames the logo */}
      <span aria-hidden className="frame absolute inset-x-0 bottom-[0.14em] top-[0.56em] border-[max(2px,0.035em)]" />
      <span aria-hidden className="type-display relative bg-bg px-[0.12em] text-[0.46em] tracking-[0.02em] text-fg">
        Nosso
      </span>
      <span aria-hidden className="relative -mt-[0.04em] block">
        {/* yellow paint stroke behind AFTER */}
        <span className="distress absolute -inset-x-[0.06em] bottom-[0.06em] top-[0.3em] -rotate-2 bg-accent/90" />
        <span className="type-display distress relative block text-edition [text-shadow:0.03em_0.03em_0_rgb(0_0_0/0.35)]">
          After
        </span>
      </span>
      {line && (
        <span
          aria-hidden
          className="relative mt-[0.02em] whitespace-nowrap bg-bg px-[0.5em] text-[0.105em] font-bold uppercase tracking-[0.2em] text-fg [font-variation-settings:'wdth'_110]"
        >
          {line}
        </span>
      )}
    </span>
  );
}

/** "››››" — the arrow run the flyers put after calls to action. */
export function Chevrons({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`chevrons ${className}`}>
      ››››
    </span>
  );
}

/** Tape strip with the brand lines on loop (decorative; content is repeated for the animation). */
export function BrandMarquee({ items, tone = "edition" }: { items: string[]; tone?: "edition" | "accent" }) {
  const bg = tone === "accent" ? "bg-accent text-on-accent" : "bg-edition text-on-edition";
  const run = [...items, ...items, ...items, ...items];
  return (
    <div className={`relative overflow-hidden ${bg} py-2.5`} aria-hidden>
      <div className="flex w-max animate-marquee gap-6 whitespace-nowrap motion-reduce:animate-none">
        {[0, 1].map((k) => (
          <span key={k} className="flex gap-6">
            {run.map((t, i) => (
              <span key={i} className="type-headline text-lg">
                {t} <span className="mx-2">✦</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical "EVENTO PARA MAIORES DE 18 ANOS", as on the side of the flyers. */
export function AgeStamp({ rating, className = "" }: { rating?: string | null; className?: string }) {
  if (!rating || !/18/.test(rating)) return null;
  return (
    <span className={`type-label text-[0.625rem] text-muted [writing-mode:vertical-rl] rotate-180 ${className}`}>
      Evento para maiores de 18 anos
    </span>
  );
}

/** Flyer date block: big "25.SET" + "SEXTA-FEIRA • 23H" between thin rules. */
export function FlyerDate({ date, size = "md" }: { date: Date | string; size?: "sm" | "md" | "lg" }) {
  const big = size === "lg" ? "text-6xl sm:text-7xl" : size === "md" ? "text-5xl" : "text-3xl";
  return (
    <div>
      <time dateTime={new Date(date).toISOString()} className={`type-date block ${big} text-fg`}>
        {flyerDate(date)}
      </time>
      <p className="type-label mt-2 flex items-center gap-2 text-fg-2">
        <span aria-hidden className="h-px w-4 bg-fg-2" />
        {flyerWeekday(date)} <span aria-hidden>•</span> {flyerTime(date)}
        <span aria-hidden className="h-px w-4 bg-fg-2" />
      </p>
    </div>
  );
}

/** Sticker-like status tag ("ESGOTADO", "ÚLTIMOS INGRESSOS"). */
export function Sticker({ children, tone = "edition" }: { children: React.ReactNode; tone?: "edition" | "accent" | "muted" }) {
  const cls =
    tone === "accent" ? "bg-accent text-on-accent" : tone === "muted" ? "bg-surface-2 text-fg-2" : "bg-edition text-on-edition";
  return <span className={`type-label inline-block -rotate-2 px-2 py-1 text-[0.6875rem] ${cls}`}>{children}</span>;
}

export function InstagramIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
