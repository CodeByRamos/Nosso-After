import { Sticker } from "@/components/brand/brand";

/**
 * Event flyer. Flyers carry text (date, line-up, venue), so they are never cropped: fixed 4:5 box
 * (the brand's feed format) with object-contain on black — no layout shift, no lost information.
 */
export function EventPoster({
  src,
  alt,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative aspect-[4/5] overflow-hidden bg-surface ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote flyer URLs, see docs/BRAND.md (images) */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className="absolute inset-0 size-full object-contain"
      />
    </div>
  );
}

export function availabilitySticker(ev: { status: string; available: number; capacity: number; minPrice: number | null }) {
  if (ev.status === "SOLD_OUT" || (ev.capacity > 0 && ev.available === 0)) return <Sticker tone="muted">Esgotado</Sticker>;
  if (ev.minPrice === null) return <Sticker tone="muted">Vendas em breve</Sticker>;
  if (ev.capacity > 0 && ev.available / ev.capacity <= 0.15) return <Sticker tone="accent">Últimos ingressos</Sticker>;
  return <Sticker>Vendas abertas</Sticker>;
}
