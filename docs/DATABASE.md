# DATABASE

PostgreSQL (desenvolvido e testado no 18; compatível com 15+). Schema em
`src/server/db/schema.ts`, migrations SQL em `drizzle/` (**nunca edite uma migration aplicada**;
gere uma nova com `npm run db:generate`). Migrations custom (triggers) seguem o mesmo journal.

## Convenções

- PK `uuid` (`gen_random_uuid()`); `bigserial` só nas tabelas append-only (`audit_logs`, `order_events`).
- Dinheiro em **centavos inteiros**; percentuais em **basis points**.
- `timestamptz` sempre; `created_at`/`updated_at` nas tabelas mutáveis; soft delete (`deleted_at`) em `organizations` e `events`.
- Toda tabela de tenant tem `organization_id` (direto ou via evento).
- E-mails guardados em minúsculas (`CHECK email = lower(email)`).

## Entidades

| Grupo | Tabelas |
|---|---|
| Identidade/tenancy | `organizations`, `users`, `memberships` (role por org), `sessions` |
| Catálogo | `venues`, `events`, `ticket_types`, `ticket_batches` (lotes) |
| Venda | `customers`, `orders`, `order_items`, `order_events`, `fee_rules`, `fees` |
| Pagamento | `payments`, `payment_attempts`, `provider_transactions`, `refunds` |
| Acesso | `tickets`, `check_ins` |
| Infra | `webhook_events`, `idempotency_keys`, `audit_logs`, `rate_limits`, `email_outbox`, `mock_psp_transactions` (só DEMO) |

Fase 2: `coupons`, `coupon_batches`, `coupon_redemptions`, `promoters`, `reconciliation_issues`;
`orders` ganhou `coupon_id`, `promoter_id`, `promoter_commission_amount`; `order_items.unit_discount`;
`users` ganhou campos de MFA e `must_change_password`; `events` ganhou `accent_color`, `lineup`, `highlights`.
Ainda sem tabela: `Settlement` (depende da API de relatórios do PSP). `EventSession`
não é necessária hoje (um evento = uma sessão). O schema de `orders` já tem `discount_amount`.

## Invariantes no banco

| Constraint | Garante |
|---|---|
| `ticket_batches_capacity_ck` | `sold + reserved <= quantity` (sem overselling) |
| `orders_total_ck` | `total = subtotal − discount + fee` |
| `orders_refunded_ck`, `payments_refunded_ck` | reembolsado ≤ total |
| `payments_one_active_per_order_uq` (parcial) | no máximo 1 pagamento vivo por pedido |
| `payments_provider_payment_uq` | id do PSP único por provider |
| `refunds_one_inflight_uq` (parcial) | 1 reembolso em andamento por pagamento |
| `check_ins_one_valid_per_ticket_uq` (parcial) | um ingresso entra uma única vez |
| `tickets_checkin_ck` | `CHECKED_IN` ⇔ `checked_in_at` preenchido |
| `webhook_events_dedupe_uq` | cada entrega de webhook processada uma vez |
| `idempotency_scope_key_uq` | chave idempotente única por escopo |
| `payments_last_four_ck` | só 4 dígitos numéricos |
| triggers `forbid_mutation` | `audit_logs` e `order_events` append-only |

## Índices principais

`orders(organization_id, created_at)`, `orders(event_id, status)`, parcial `orders(expires_at) WHERE
AWAITING_PAYMENT` (job de expiração), `payments(status, updated_at)` (sync), parcial
`webhook_events(next_attempt_at) WHERE FAILED` (retry), `tickets(event_id, status)` (portaria),
`check_ins(event_id, created_at)`, `audit_logs(organization_id, created_at)`.

## Seed

`npm run db:seed`: **só com `APP_ENV=development`**. Cria organização, super admin, operador de
portaria, regra de taxa global (10%, marcada "dev") e um evento de exemplo publicado com três lotes.
Dados de evento de verdade são cadastrados em `/admin/events`.

## Retenção

Ver SECURITY.md → LGPD. Os jobs de purga de `sessions`, `orders.ip` e `webhook_events.payload` estão
aplicados pelo job `housekeeping` (função `applyRetention`), junto com `idempotency_keys` e `rate_limits`.
