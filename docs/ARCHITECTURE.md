# ARCHITECTURE

## Visão geral

```
 Navegador (site público / checkout / portaria / admin)
        │  HTTPS, cookies httpOnly, CSP com nonce
        ▼
 Next.js (App Router) ─ proxy.ts (request-id, CSRF p/ /api, CSP)
   ├─ Server Components / Server Actions (admin)         ─┐
   └─ Route Handlers /api/* (checkout, check-in, webhooks)│ Presentation
        ▼                                                 ─┘
 src/server/services/*   ← casos de uso (Application)
   orders · payments · webhooks · refunds · tickets · checkin · jobs · catalog · admin-*
        ▼                    ▼
 src/server/domain/*     src/server/payments/*        src/server/lib/*
 (fees, money,           PaymentProvider + registry    env, logger, audit, idempotency,
  payment-status)        ├─ mock (DEMO)                rate-limit, tokens, crypto
                         └─ mercadopago (SDK oficial)
        ▼
 PostgreSQL (Drizzle) — única fonte de verdade; invariantes também em CHECK/UNIQUE/triggers
```

Regras de dependência:
- `domain` é puro (sem I/O), testado em unidade.
- `app/*` chama `services`, nunca adaptadores de PSP.
- Só `payments/providers/<psp>` importa SDK de PSP (regra de ESLint).
- Toda mutação sensível grava em `audit_logs` na **mesma transação**.

## Pastas

```
src/app/(site)       site público: home, /eventos/[slug], checkout, /pedido/[id], termos, privacidade
src/app/admin        painel do produtor (Server Components + Server Actions)
src/app/checkin      leitor de QR para celular
src/app/api          API HTTP (ver API.md)
src/components       UI (site, admin, checkin)
src/server           back-end: auth, db, domain, lib, payments, services
src/validators       schemas Zod compartilhados
drizzle/             migrations SQL versionadas
tests/               unit + integration (Postgres real)
docs/                documentação + ADRs
```

## Fluxo principal

```
Evento → lote(s) → dados → método → revisão (quote com taxa) → POST /api/orders
  └ transação: advisory lock (comprador+evento) → limite por comprador → UPDATE condicional
    de estoque (lotes em ordem de id) → pedido + itens + fees + order_events + audit
→ /pedido/[id] → POST /api/payments (Idempotency-Key; chave no PSP = pay_<payment.id>)
→ PSP → webhook assinado → webhook_events (dedupe) → getPayment() → máquina de estados
  └ transação: lock pedido → lock pagamento → PAID → estoque COMMITTED → tickets → outbox de e-mail
→ QR (HMAC) → /checkin → UPDATE atômico VALID→CHECKED_IN (+ índice único em check_ins)
```

Máquinas de estado:
- **Order:** `AWAITING_PAYMENT → PAID → PARTIALLY_REFUNDED → REFUNDED`, `AWAITING_PAYMENT → EXPIRED | CANCELLED`, `→ REFUND_PENDING` (pagamento tardio sem estoque).
- **Inventory (por pedido):** `RESERVED → COMMITTED | RELEASED` (idempotente).
- **Payment:** ver PAYMENTS.md.
- **Ticket:** `VALID → CHECKED_IN`, `VALID → REFUNDED | CANCELLED`.
- **Timeline:** `order_events` (append-only) registra ORDER_CREATED, INVENTORY_RESERVED, PAYMENT_PENDING, PAYMENT_APPROVED, INVENTORY_COMMITTED, TICKETS_ISSUED, PAYMENT_FAILED, INVENTORY_RELEASED, ORDER_EXPIRED, ORDER_REFUNDED, CHARGEBACK...

## Concorrência (resumo)

| Risco | Defesa |
|---|---|
| Overselling | UPDATE condicional atômico + `CHECK (sold+reserved <= quantity)` |
| Mesmo comprador em paralelo | `pg_advisory_xact_lock(hash(evento:email))` |
| Deadlock | ordem global de locks: pedido → pagamento → lotes (ordenados) → tickets |
| Dois pagamentos vivos no mesmo pedido | índice único parcial `payments_one_active_per_order_uq` |
| Webhook duplicado / fora de ordem | `UNIQUE(provider, dedupe_key)` + transições monotônicas |
| Emissão dupla de ingressos | transição de status sob lock + checagem de existência |
| Check-in simultâneo | `UPDATE … WHERE status='VALID'` + índice único parcial |
| Reembolso em dobro | 1 refund em andamento por pagamento (índice parcial) + idempotency key no PSP |
| Retry de cliente | `idempotency_keys` (replay da resposta, 422 para payload diferente) |

## Jobs

`expire-orders`, `retry-webhooks`, `sync-payments`, `deliver-emails`, `housekeeping`. Todos
idempotentes. Rodam por `POST /api/cron/<job>` (Bearer `CRON_SECRET`). Em development rodam no
próprio processo (`instrumentation.ts`).

## Observabilidade

- Logs JSON estruturados (`lib/logger.ts`) com `request_id`, `user_id`, `order_id`, `payment_id`,
  `provider_transaction_id` via AsyncLocalStorage, e redação obrigatória de chaves sensíveis e de
  sequências parecidas com PAN.
- `x-request-id` propagado (proxy → handler → resposta → audit_logs).
- `GET /api/health` (banco + provider). Pronto para uptime check.
- `payment_attempts` registra toda chamada ao PSP (operação, resultado, latência, erro).
- Pendente (Fase 2): Sentry/OTel e alertas. Os pontos de integração são `logger.error` e os status
  `webhook_events.FAILED` / `payments.failure_code = INTEGRITY_MISMATCH`.

## Decisões

Ver [adr/](adr/).
