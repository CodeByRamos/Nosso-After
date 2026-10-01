import { describe, expect, it } from "vitest";
import { BRAND, contrast, editionTheme, flyerDate, flyerTime, flyerWeekday, parseHighlights, parseLineup } from "@/lib/brand";
import { eventFormSchema } from "@/validators/admin";

describe("brand palette", () => {
  it("measured brand colors are readable on the flyer black", () => {
    expect(contrast(BRAND.pink, BRAND.black)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND.yellow, BRAND.black)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND.white, BRAND.black)).toBeGreaterThan(19);
  });

  it("edition color falls back to brand pink when missing, malformed or unreadable", () => {
    expect(editionTheme(null)["--color-edition"]).toBe(BRAND.pink);
    expect(editionTheme("red")["--color-edition"]).toBe(BRAND.pink);
    expect(editionTheme("#1a1a1a")["--color-edition"]).toBe(BRAND.pink);
    expect(editionTheme("#2EE59D")["--color-edition"]).toBe("#2ee59d");
  });

  it("picks the text color with the best contrast on edition-colored buttons", () => {
    expect(editionTheme(BRAND.pink)["--color-on-edition"]).toBe(BRAND.black);
    expect(editionTheme("#ffd700")["--color-on-edition"]).toBe(BRAND.black);
  });
});

describe("flyer formats", () => {
  const d = new Date("2026-09-26T02:00:00Z"); // 25/09 23:00 in São Paulo
  it("formats dates like the flyers (25.SET · SEXTA-FEIRA · 23H)", () => {
    expect(flyerDate(d)).toBe("25.SET");
    expect(flyerWeekday(d)).toBe("SEXTA-FEIRA");
    expect(flyerTime(d)).toBe("23H");
    expect(flyerTime(new Date("2026-09-26T02:30:00Z"))).toBe("23H30");
  });

  it("parses line-up and perks in the flyer format", () => {
    expect(parseLineup("DJ Blakes\n\n  MC Luuky  \n")).toEqual(["DJ Blakes", "MC Luuky"]);
    expect(parseHighlights("Welcome Licor 43 | 50 primeiros\nAniversariante do mês")).toEqual([
      { title: "Welcome Licor 43", detail: "50 primeiros" },
      { title: "Aniversariante do mês", detail: null },
    ]);
  });
});

describe("event form brand fields", () => {
  const base = {
    organizationId: "568a6599-253e-4893-a0a4-4b2403ceb822",
    name: "Submundo",
    slug: "submundo",
    venueName: "Lucky Scope",
    venueCity: "Guarujá",
    venueState: "SP",
    startsAt: "2026-10-28T23:00",
    endsAt: "2026-10-29T06:00",
  };
  it("rejects edition colors that would be unreadable on black", () => {
    expect(eventFormSchema.safeParse({ ...base, accentColor: "#222222" }).success).toBe(false);
    expect(eventFormSchema.safeParse({ ...base, accentColor: "#FFD700" }).success).toBe(true);
  });
  it("accepts https or site-relative flyer URLs only", () => {
    for (const ok of ["https://cdn.example.com/flyer.jpg", "/flyers/submundo.webp"]) {
      expect(eventFormSchema.safeParse({ ...base, coverImageUrl: ok }).success).toBe(true);
    }
    for (const bad of ["http://x.com/a.jpg", "javascript:alert(1)", "/../etc/passwd"]) {
      expect(eventFormSchema.safeParse({ ...base, coverImageUrl: bad }).success).toBe(false);
    }
  });
});
