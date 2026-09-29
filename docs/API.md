# API

Base: `/api`. JSON. Erros no formato `{ "error": { "code", "message", "fields?" }, "requestId" }`.
Todas as respostas levam `x-request-id`. Mutações com cookie exigem `Origin` do mesmo host.

## Públicas / comprador

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/health` | — | status do banco e do provider de pagamento |
| GET | `/api/events` | — | eventos publicados (cache 30 s) |
| GET | `/api/events/{id}` | — | evento + lotes com disponibilidade |
| POST | `/api/orders/quote` | — | `{eventId, items[{batchId,quantity}], paymentMethod}` → subtotal, **taxa**, total. Não reserva |
| POST | `/api/orders` | `Idempotency-Key` | cria pedido + reserva. Body: quote + `buyer{name,email,phone,document?,acceptTerms,marketingOptIn}`. Define o cookie de acesso ao pedido. 201 |
| GET | `/api/orders/{id}` | cookie do pedido **ou** staff `orders:read` | status, pagamento (QR Pix), ingressos (com QR SVG quando pago) |
| POST | `/api/payments` | cookie do pedido + `Idempotency-Key` | `{orderId, method:"PIX"}` ou `{orderId, method:"CREDIT_CARD", card:{token, paymentMethodId, issuerId?, installments, document?}}` |
| POST | `/api/dev/mock-psp/{paymentId}` | cookie do pedido, **somente DEMO** | `{action:"pay_pix"}`: simula o pagamento no simulador de PSP |

Erros de negócio: `SOLD_OUT` (409), `LIMIT_EXCEEDED` (409), `SALES_CLOSED` (409), `ORDER_EXPIRED`
(409), `IDEMPOTENCY_MISMATCH` (422), `IDEMPOTENCY_IN_PROGRESS` (409), `RATE_LIMITED` (429),
`PAYMENT_PROVIDER_ERROR` (502).

### Idempotência

`Idempotency-Key` com 8 a 128 caracteres `[A-Za-z0-9_-:.]`. Mesma chave + mesmo corpo → a resposta
original é repetida (`idempotent-replayed: true`). Mesma chave + corpo diferente → 422. Erros 5xx
liberam a chave para retry. Retenção de 48 h.

## Staff (cookie de sessão)

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/api/payments/{id}` | `finance:read` | pagamento + tentativas no PSP + snapshot do PSP |
| POST | `/api/refunds` | `refunds:create` + `Idempotency-Key` | `{orderId, amount?(centavos), reason}` |
| GET | `/api/tickets?page&q&status&eventId` | `tickets:read` | lista paginada (25) |
| GET | `/api/tickets/{id}` | `tickets:read` | ingresso + leituras (sem o payload do QR) |
| POST | `/api/checkins` | `checkin:perform` | `{eventId, qr, deviceId?}` → `{result: VALID\|ALREADY_USED\|INVALID\|CANCELLED\|REFUNDED\|WRONG_EVENT, ticket?}` |

O CRUD de eventos, lotes e regras de taxa, e os reembolsos pelo painel, usam **Server Actions**
(`src/app/admin/actions.ts`), com a mesma validação Zod, RBAC e auditoria.

## Integrações

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/webhooks/{provider}` | assinatura do PSP | `mercadopago` (x-signature) · `mock` (x-mock-signature). 401 se inválida, 200 após persistir |
| GET/POST | `/api/cron/{job}` | `Authorization: Bearer CRON_SECRET` | `expire-orders`, `retry-webhooks`, `sync-payments`, `deliver-emails`, `housekeeping`, `all` |

## Rotas de página

`/`, `/eventos/{slug}`, `/eventos/{slug}/checkout?itens=<batchId>:<qtd>,…`, `/pedido/{id}`,
`/pedido/{id}/acesso?token=` (link mágico → cookie → redirect), `/login`, `/admin/**`, `/checkin/**`,
`/termos`, `/privacidade`, `/sitemap.xml`, `/robots.txt`.
