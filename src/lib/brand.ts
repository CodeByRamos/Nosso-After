/**
 * Nosso After brand constants (see docs/BRAND.md for the evidence behind each value).
 * Colors were sampled from the brand's own posts (Instagram @nossoafterguaruja, set/2026).
 * Client-safe: no server imports.
 */
export const BRAND = {
  /** Flyer background: near pure black. */
  black: "#050505",
  /** "AFTER" / headline pink, sampled from the "Comemore seu aniversário" post (avg #F52781). */
  pink: "#F52781",
  /** Paint-splash / "Veja os benefícios" / hazard-stripe yellow (avg #F8E22F). */
  yellow: "#F8E22F",
  white: "#FFFFFF",
  tagline: "O after de todas as festas",
  claim: "A Nº1 do Guarujá",
  instagram: "https://www.instagram.com/nossoafterguaruja/",
  instagramHandle: "@nossoafterguaruja",
} as const;

function luminance(hex: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrast(a: string, b: string) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/**
 * Edition color → CSS variables. Falls back to brand pink when missing or unreadable on black
 * (WCAG AA 4.5:1), and picks black/white text for buttons filled with that color.
 */
export function editionTheme(accent: string | null | undefined): Record<string, string> {
  const color = accent && isHexColor(accent) && contrast(accent, BRAND.black) >= 4.5 ? accent.toLowerCase() : BRAND.pink;
  const onAccent = contrast(color, BRAND.black) >= contrast(color, BRAND.white) ? BRAND.black : BRAND.white;
  return { "--color-edition": color, "--color-on-edition": onAccent };
}

// ---- dates in the flyer format: "25.SET", "SEXTA-FEIRA • 23H" ----

const TZ = "America/Sao_Paulo";

export function flyerDate(d: Date | string) {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).formatToParts(new Date(d));
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = (parts.find((p) => p.type === "month")?.value ?? "").replace(".", "").toUpperCase();
  return `${day}.${month}`;
}

export function flyerWeekday(d: Date | string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long" }).format(new Date(d)).toUpperCase();
}

export function flyerTime(d: Date | string) {
  const t = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
  return t.endsWith(":00") ? `${t.slice(0, 2)}H` : t.replace(":", "H");
}

/** "Welcome Licor 43 | 50 primeiros" → { title, detail } (flyer perk format). */
export function parseHighlights(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => {
      const [title, detail] = l.split("|").map((s) => s.trim());
      return { title: title ?? l, detail: detail || null };
    });
}

export const parseLineup = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
