# ADR-0004 — Confirmação de pagamento: webhook + consulta ao PSP

- **Status:** Aceito · **Data:** 2026-09-28

## Decisão

1. O retorno síncrono da criação do pagamento **nunca** marca um pagamento como `PAID` nem emite
   ingresso. Ele só registra o `provider_payment_id` e o estado inicial (`PENDING`/`PROCESSING`).
2. O webhook `POST /api/webhooks/[provider]`:
   - valida a assinatura (HMAC) **antes** de qualquer outra coisa. Se for inválida, responde 401 e
     registra no log (sem payload);
   - persiste o evento em `webhook_events` com `UNIQUE(provider, dedupe_key)`. Duplicatas retornam 200
     sem reprocessar;
   - **não confia no corpo**: chama `provider.getPayment(id)` e aplica o estado retornado pela API
     oficial (`syncPaymentFromProvider`);
   - se o processamento falhar, marca `FAILED` com `next_attempt_at` (backoff exponencial) e o job
     `retry-webhooks` tenta de novo. Responde 200 depois de persistir, para evitar tempestade de retries do PSP.
3. O job `sync-pending-payments` consulta o PSP para pagamentos pendentes há mais de alguns minutos
   (fallback para webhook perdido).
4. Todas as transições passam por uma máquina de estados (`domain/payment-status.ts`) que ignora
   regressões fora de ordem (ex.: `PAID → PENDING`).
5. `PAID` confirma o pedido, converte a reserva em venda e emite os ingressos **na mesma transação**,
   com o pedido travado. Por isso a emissão é idempotente.

## Status normalizados

`PENDING, PROCESSING, AUTHORIZED, PAID, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED, CHARGEBACK, EXPIRED`.
Cada adaptador tem uma função pura `mapStatus(pspStatus, detail) → InternalStatus`, coberta por testes.
