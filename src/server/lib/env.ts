import { z } from "zod";

/**
 * Environment configuration, validated once at startup.
 * Secrets only ever come from process.env — never from code or the database.
 */
const secret = z.string().min(32, "must be at least 32 characters");

const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1),
    QR_SIGNING_SECRET: secret,
    ORDER_ACCESS_SECRET: secret,
    CRON_SECRET: secret,
    ORDER_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(60).default(15),

    PAYMENT_PROVIDER: z.enum(["mock", "mercadopago"]).default("mock"),
    MOCK_PSP_WEBHOOK_SECRET: secret.optional(),

    MERCADOPAGO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
    MERCADOPAGO_PUBLIC_KEY: z.string().optional(),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
    MERCADOPAGO_STATEMENT_DESCRIPTOR: z.string().max(13).default("NOSSOAFTER"),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "mock") {
      if (env.APP_ENV === "production") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_PROVIDER"],
          message: "The mock (DEMO) payment provider is forbidden in production.",
        });
      }
      if (!env.MOCK_PSP_WEBHOOK_SECRET) {
        ctx.addIssue({ code: "custom", path: ["MOCK_PSP_WEBHOOK_SECRET"], message: "required for mock provider" });
      }
    }
    if (env.PAYMENT_PROVIDER === "mercadopago") {
      for (const key of ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_PUBLIC_KEY", "MERCADOPAGO_WEBHOOK_SECRET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required for mercadopago provider" });
      }
      // Never use production credentials outside production.
      if (env.MERCADOPAGO_ENVIRONMENT === "production" && env.APP_ENV !== "production") {
        ctx.addIssue({
          code: "custom",
          path: ["MERCADOPAGO_ENVIRONMENT"],
          message: "production PSP credentials are only allowed with APP_ENV=production",
        });
      }
      if (env.APP_ENV === "production" && env.MERCADOPAGO_ENVIRONMENT !== "production") {
        ctx.addIssue({
          code: "custom",
          path: ["MERCADOPAGO_ENVIRONMENT"],
          message: "APP_ENV=production requires MERCADOPAGO_ENVIRONMENT=production",
        });
      }
    }
    if (env.APP_ENV === "production" && !env.APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must be https in production" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Only print variable names + messages, never values.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = undefined;
}

export function isProduction() {
  return env().APP_ENV === "production";
}
