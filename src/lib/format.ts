/** Client-safe formatting helpers (pt-BR, America/Sao_Paulo). */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (cents: number) => brl.format(cents / 100);

const TZ = "America/Sao_Paulo";
export const formatDate = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
export const formatDateTime = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const formatWeekdayDate = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" }).format(new Date(d));
export const formatTime = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));

/** Value for <input type="datetime-local"> in São Paulo time. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const shifted = new Date(new Date(d).getTime() - 3 * 3600_000);
  return shifted.toISOString().slice(0, 16);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export const ORDER_STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Aguardando pagamento",
  PAID: "Pago",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
  REFUND_PENDING: "Reembolso pendente",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  REFUNDED: "Reembolsado",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  AUTHORIZED: "Autorizado",
  PAID: "Aprovado",
  FAILED: "Recusado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  CHARGEBACK: "Chargeback",
  EXPIRED: "Expirado",
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  VALID: "Válido",
  CHECKED_IN: "Utilizado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
};

export const METHOD_LABEL: Record<string, string> = { PIX: "Pix", CREDIT_CARD: "Cartão" };
