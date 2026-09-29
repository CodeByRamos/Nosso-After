import { env } from "@/server/lib/env";
import type { PaymentProvider, ProviderId } from "./provider";
import { MockPaymentProvider } from "./providers/mock/mock-provider";
import { MercadoPagoProvider } from "./providers/mercadopago/mercadopago-provider";

/**
 * Single place that knows which PSP adapters exist. The rest of the app asks for
 * "the active provider" (new payments) or "the provider that owns this payment" (existing ones),
 * so switching PSPs never strands in-flight payments.
 */
const instances = new Map<ProviderId, PaymentProvider>();

function build(id: ProviderId): PaymentProvider {
  const e = env();
  switch (id) {
    case "mock": {
      if (e.APP_ENV === "production") throw new Error("mock provider is forbidden in production");
      if (!e.MOCK_PSP_WEBHOOK_SECRET) throw new Error("MOCK_PSP_WEBHOOK_SECRET not configured");
      return new MockPaymentProvider(e.MOCK_PSP_WEBHOOK_SECRET);
    }
    case "mercadopago": {
      if (!e.MERCADOPAGO_ACCESS_TOKEN || !e.MERCADOPAGO_PUBLIC_KEY || !e.MERCADOPAGO_WEBHOOK_SECRET) {
        throw new Error("Mercado Pago credentials not configured");
      }
      return new MercadoPagoProvider({
        accessToken: e.MERCADOPAGO_ACCESS_TOKEN,
        publicKey: e.MERCADOPAGO_PUBLIC_KEY,
        webhookSecret: e.MERCADOPAGO_WEBHOOK_SECRET,
        environment: e.MERCADOPAGO_ENVIRONMENT === "production" ? "PRODUCTION" : "SANDBOX",
        statementDescriptor: e.MERCADOPAGO_STATEMENT_DESCRIPTOR,
      });
    }
  }
}

export function getProvider(id: string): PaymentProvider {
  if (id !== "mock" && id !== "mercadopago") throw new Error(`unknown payment provider ${id}`);
  let p = instances.get(id);
  if (!p) {
    p = build(id);
    instances.set(id, p);
  }
  return p;
}

export function getActiveProvider(): PaymentProvider {
  return getProvider(env().PAYMENT_PROVIDER);
}

export function isKnownProvider(id: string): id is ProviderId {
  return id === "mock" || id === "mercadopago";
}

/** Tests only. */
export function resetProviders() {
  instances.clear();
}
