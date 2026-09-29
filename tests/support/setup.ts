import { afterAll } from "vitest";
import { TEST_DB_PORT } from "./constants";

// Test-only values (never used elsewhere).
Object.assign(process.env, {
  APP_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:${TEST_DB_PORT}/nossoafter_test`,
  DB_POOL_MAX: "40",
  QR_SIGNING_SECRET: "test-qr-secret-0123456789abcdefghijklmnop",
  ORDER_ACCESS_SECRET: "test-order-secret-0123456789abcdefghijklmn",
  CRON_SECRET: "test-cron-secret-0123456789abcdefghijklmnop",
  PAYMENT_PROVIDER: "mock",
  MOCK_PSP_WEBHOOK_SECRET: "test-mock-webhook-secret-0123456789abcdef",
  ORDER_RESERVATION_MINUTES: "15",
});

afterAll(async () => {
  const { closeDb } = await import("@/server/db/client");
  await closeDb();
});
