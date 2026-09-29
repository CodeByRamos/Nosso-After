import { z } from "zod";
import { cpfSchema, emailSchema, personNameSchema, phoneSchema, uuidSchema } from "./common";

export const paymentMethodSchema = z.enum(["PIX", "CREDIT_CARD"]);

export const orderItemsSchema = z
  .array(z.object({ batchId: uuidSchema, quantity: z.number().int().min(1).max(20) }))
  .min(1, "Selecione ao menos um ingresso")
  .max(10)
  .refine((items) => new Set(items.map((i) => i.batchId)).size === items.length, "Lote repetido");

export const quoteSchema = z.object({
  eventId: uuidSchema,
  items: orderItemsSchema,
  paymentMethod: paymentMethodSchema,
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const buyerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  /** Optional unless the PSP/method requires it (the card form collects it for card payments). */
  document: cpfSchema.optional().or(z.literal("").transform(() => undefined)),
  acceptTerms: z.literal(true, { message: "É preciso aceitar os termos de uso" }),
  marketingOptIn: z.boolean().default(false),
});

export const createOrderSchema = quoteSchema.extend({ buyer: buyerSchema });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const createPaymentSchema = z.discriminatedUnion("method", [
  z.object({ orderId: uuidSchema, method: z.literal("PIX") }),
  z.object({
    orderId: uuidSchema,
    method: z.literal("CREDIT_CARD"),
    card: z.object({
      token: z.string().min(8).max(256),
      paymentMethodId: z.string().min(2).max(40),
      issuerId: z.string().max(40).nullish(),
      installments: z.number().int().min(1).max(12),
      /** Cardholder CPF collected by the PSP card form. */
      document: cpfSchema.optional(),
    }),
  }),
]);
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
