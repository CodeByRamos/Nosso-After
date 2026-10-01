import { z } from "zod";
import { BRAND, contrast } from "@/lib/brand";
import { reaisToCentsSchema, slugSchema, uuidSchema } from "./common";

/** <input type="datetime-local"> value, interpreted in America/Sao_Paulo (UTC-03:00, no DST). */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida")
  .transform((v) => new Date(`${v}:00-03:00`));

const optionalLocalDateTime = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(localDateTimeSchema.optional());

export const eventFormSchema = z
  .object({
    organizationId: uuidSchema,
    name: z.string().trim().min(3).max(120),
    slug: slugSchema,
    description: z.string().trim().max(10_000).default(""),
    coverImageUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || undefined)
      .pipe(
        z
          .string()
          .refine(
            (u) => (/^https:\/\/\S+$/.test(u) && URL.canParse(u)) || /^\/(?!.*\.\.)[\w\-./]+$/.test(u),
            "Use um link https:// ou um caminho do site começando com /",
          )
          .optional(),
      ),
    venueName: z.string().trim().min(2).max(120),
    venueAddress: z.string().trim().max(200).optional(),
    venueCity: z.string().trim().min(2).max(80),
    venueState: z.string().trim().length(2).toUpperCase(),
    startsAt: localDateTimeSchema,
    endsAt: localDateTimeSchema,
    salesStartAt: optionalLocalDateTime,
    salesEndAt: optionalLocalDateTime,
    ageRating: z.string().trim().max(40).optional(),
    accentColor: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((v) => v || undefined)
      .pipe(
        z
          .string()
          .regex(/^#[0-9a-f]{6}$/, "Use uma cor hexadecimal (#rrggbb)")
          .refine((c) => contrast(c, BRAND.black) >= 4.5, "Cor escura demais para o fundo preto (contraste < 4,5:1)")
          .optional(),
      ),
    lineup: z.string().trim().max(2_000).optional(),
    highlights: z.string().trim().max(2_000).optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "Término deve ser após o início" })
  .refine((v) => !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt, {
    path: ["salesEndAt"],
    message: "Fim das vendas deve ser após o início",
  });
export type EventFormInput = z.infer<typeof eventFormSchema>;

export const eventStatusSchema = z.enum(["DRAFT", "PUBLISHED", "PAUSED", "SOLD_OUT", "FINISHED", "CANCELLED"]);

export const batchFormSchema = z
  .object({
    eventId: uuidSchema,
    batchId: uuidSchema.optional(),
    ticketTypeName: z.string().trim().min(2).max(60),
    name: z.string().trim().min(2).max(60),
    price: reaisToCentsSchema,
    quantity: z.coerce.number().int().min(0).max(1_000_000),
    maxPerCustomer: z.coerce.number().int().min(1).max(100),
    salesStart: optionalLocalDateTime,
    salesEnd: optionalLocalDateTime,
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]),
  })
  .refine((v) => !v.salesStart || !v.salesEnd || v.salesEnd > v.salesStart, {
    path: ["salesEnd"],
    message: "Fim deve ser após o início",
  });

export const feeRuleFormSchema = z.object({
  name: z.string().trim().min(3).max(80),
  organizationId: uuidSchema.optional().or(z.literal("").transform(() => undefined)),
  eventId: uuidSchema.optional().or(z.literal("").transform(() => undefined)),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD"]).optional().or(z.literal("").transform(() => undefined)),
  appliesPer: z.enum(["TICKET", "ORDER"]),
  fixedAmount: reaisToCentsSchema,
  percentage: z
    .string()
    .trim()
    .regex(/^\d{1,3}(,\d{1,2})?$/, "Percentual inválido")
    .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
    .refine((bps) => bps <= 10_000, "Máximo 100%"),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  activeFrom: localDateTimeSchema,
  activeUntil: optionalLocalDateTime,
});

export const refundFormSchema = z.object({
  orderId: uuidSchema,
  mode: z.enum(["FULL", "PARTIAL"]),
  amount: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(reaisToCentsSchema.optional()),
  reason: z.string().trim().min(5, "Descreva o motivo").max(500),
});

export const checkInRequestSchema = z.object({
  eventId: uuidSchema,
  qr: z.string().trim().min(10).max(200),
  deviceId: z.string().trim().max(64).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  eventId: uuidSchema.optional().or(z.literal("").transform(() => undefined)),
});

const optionalUuid = uuidSchema.optional().or(z.literal("").transform(() => undefined));
const optionalPositiveInt = z
  .string()
  .optional()
  .transform((v) => (v ? Number(v) : undefined))
  .pipe(z.number().int().min(1).max(1_000_000).optional());

const percentToBps = z
  .string()
  .trim()
  .regex(/^\d{1,3}(,\d{1,2})?$/, "Percentual inválido")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
  .refine((bps) => bps <= 10_000, "Máximo 100%");

export const couponFormSchema = z
  .object({
    organizationId: uuidSchema,
    eventId: optionalUuid,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, "Use 3 a 32 letras, números, _ ou -"),
    description: z.string().trim().max(200).optional(),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.string().trim().min(1, "Informe o valor"),
    maxRedemptions: optionalPositiveInt,
    perCustomerLimit: z.coerce.number().int().min(1).max(100),
    validFrom: localDateTimeSchema,
    validUntil: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(localDateTimeSchema.optional()),
    batchIds: z.array(uuidSchema).max(50).default([]),
  })
  .transform((v, ctx) => {
    const parsed = v.type === "PERCENTAGE" ? percentToBps.safeParse(v.value) : reaisToCentsSchema.safeParse(v.value);
    if (!parsed.success || parsed.data <= 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Valor inválido" });
      return z.NEVER;
    }
    if (v.validUntil && v.validUntil <= v.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Fim deve ser após o início" });
      return z.NEVER;
    }
    return { ...v, value: parsed.data };
  });

export const promoterFormSchema = z.object({
  organizationId: uuidSchema,
  name: z.string().trim().min(2).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, "Use 3 a 32 letras, números, _ ou -"),
  commissionPercent: percentToBps,
  commissionFixed: reaisToCentsSchema,
});

export const memberFormSchema = z.object({
  organizationId: uuidSchema,
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["ORGANIZATION_ADMIN", "EVENT_MANAGER", "CHECKIN_OPERATOR", "PROMOTER"]),
  initialPassword: z
    .string()
    .max(200)
    .transform((v) => v || undefined)
    .optional(),
  promoterId: uuidSchema.optional().or(z.literal("").transform(() => undefined)),
});
