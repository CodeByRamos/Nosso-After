/**
 * E-mail delivery port.
 *
 * STATUS: no transactional e-mail provider is integrated yet (decision pending: Resend / SES /
 * Postmark). In development the message is written to the server log so the flow can be tested.
 * In staging/production sending throws, and messages stay PENDING in email_outbox (visible, not
 * lost) until a real transport is configured. We never pretend an e-mail was sent.
 */
import type { emailOutbox } from "@/server/db/schema";
import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";

type OutboxRow = typeof emailOutbox.$inferSelect;

export async function sendEmail(message: OutboxRow) {
  if (env().APP_ENV === "development") {
    // Dev only: the access link is logged so the developer can open the order.
    console.log(
      `\n[DEV E-MAIL] to=${message.toEmail} template=${message.template}\n${JSON.stringify(message.payload, null, 2)}\n`,
    );
    return;
  }
  if (env().APP_ENV === "test") return;
  logger.warn("email.transport_not_configured", { template: message.template });
  throw new Error("E-mail transport not configured");
}
