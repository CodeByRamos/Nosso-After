# PAYMENTS — Payment Core

> Resumo: o Nosso After tem checkout, API de pagamentos, pedidos, taxas e conciliação próprios.
> Captura, liquidação, split e devolução acontecem **só** pelas APIs oficiais do PSP.
> Nunca guardamos saldo de terceiros, nunca movemos dinheiro manualmente e nunca recebemos PAN/CVV.

Decisão do PSP: [ADR-0001](adr/0001-escolha-do-psp.md) (Mercado Pago no MVP, Pagar.me como segundo adaptador).

## Ambientes

| Modo | Provider | O que acontece | Onde pode rodar |
|---|---|---|---|
| **DEMO** | `mock` | Simulador local de PSP (estado em `mock_psp_transactions`), webhooks HMAC reais, nenhum dinheiro | development, test, staging |
| **SANDBOX** | `mercadopago` + credenciais de teste | API real do MP em modo teste | development, staging |
| **PRODUCTION** | `mercadopago` + credenciais de produção | Cobrança real | **somente** `APP_ENV=production` |

As regras são verificadas no boot (`src/server/lib/env.ts`): mock em produção falha, credencial de
produção fora de produção falha. Cada `payments.environment` grava o modo em que o pagamento foi
criado, e o site mostra uma faixa "MODO DEMO" ou "SANDBOX" sempre que o modo não é PRODUCTION.

## Contrato `PaymentProvider`

`src/server/payments/provider.ts`

| Operação | Uso |
|---|---|
| `createPayment(input, {idempotencyKey})` | Cria Pix ou cartão tokenizado. A chave é `pay_<payment.id>`, então um retry nunca gera cobrança duplicada |
| `getPayment(id)` | **Leitura autoritativa**. É o único caminho que leva um pagamento a `PAID` |
| `cancelPayment(id)` | Cancela um Pix pendente quando a reserva expira |
| `refundPayment({id, amount?})` | Reembolso total ou parcial. A chave é `refund_<refund.id>` |
| `verifyWebhook(req)` | Valida a assinatura e extrai os ids. **Não** confia no estado do payload |
| `clientConfig()` | Dados públicos para o front (public key, capacidades, ambiente) |
| `capabilities` | `pix`, `creditCard`, `installments`, `split`, `partialRefund` |

Operações conceituais pedidas no briefing e onde elas ficam:
- `createCustomer`: o MP recebe o pagador inline no pagamento, então não existe cliente no PSP.
  O comprador fica em `customers` (nosso banco).
- `createRecipient` / `createSplit`: vêm pela instrução `split` em `CreatePaymentInput`
  (`platformFeeAmount` + `sellerAccountRef`). O adaptador MP recusa com `NOT_SUPPORTED` até o fluxo
  OAuth de marketplace existir (ver "Split").
- `handleWebhook`: `verifyWebhook` + `services/webhooks.ts`.

Só `src/server/payments/providers/<psp>/` importa o SDK do PSP. Uma regra de ESLint
(`no-restricted-imports`) bloqueia `mercadopago` em qualquer outro lugar.

## Status normalizados

`PENDING, PROCESSING, AUTHORIZED, PAID, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED, CHARGEBACK, EXPIRED`

Mapeamento do Mercado Pago (`providers/mercadopago/mapping.ts`, com testes):

| MP `status` (+ detalhe) | Interno |
|---|---|
| `pending` | PENDING |
| `in_process` | PROCESSING |
| `authorized` | AUTHORIZED |
| `approved` (sem reembolso) | PAID |
| `approved` + `transaction_amount_refunded` parcial | PARTIALLY_REFUNDED |
| `in_mediation` | PAID + `payments.disputed = true` |
| `rejected` | FAILED |
| `cancelled` / `cancelled` + `expired` | CANCELLED / EXPIRED |
| `refunded` | REFUNDED (ou PARTIALLY_REFUNDED) |
| `charged_back` | CHARGEBACK (ingressos válidos são cancelados) |
| desconhecido | erro explícito (nunca "chuta" um status) |

Transições (`domain/payment-status.ts`): regressões fora de ordem são ignoradas. `FAILED`, `CANCELLED`
e `EXPIRED → PAID` são aceitas, porque o PSP é a fonte da verdade (ex.: Pix pago no último segundo).

## Fluxos

### Pix
```
POST /api/orders   → reserva estoque (15 min), pedido AWAITING_PAYMENT
POST /api/payments → payment PENDING + QR (expira junto com a reserva)
PSP → POST /api/webhooks/<provider>  (assinado)
       → persiste webhook_events (dedupe) → getPayment() autoritativo
       → PAID → estoque RESERVED→COMMITTED → tickets emitidos → e-mail na outbox
```
O retorno síncrono do `createPayment` nunca marca PAID (ADR-0004).

### Cartão
Card Payment Brick (MercadoPago.js v2) no navegador → `token` → `POST /api/payments`.
- **Responsabilidade do PSP:** captura dos dados do cartão em campos seguros (iframes), tokenização,
  3DS/antifraude, autorização com a bandeira, parcelamento, liquidação e chargeback.
- **Nossa responsabilidade:** servir a página por HTTPS com CSP restrita, não registrar o token em
  logs, guardar só bandeira + 4 últimos dígitos, e limitar as tentativas (rate limit de 5 por pedido
  por hora contra *card testing*).
- Aprovado → registrado como `PROCESSING` até a notificação ou a leitura autoritativa confirmar.
- Recusado → `FAILED`. A reserva continua valendo até expirar, então o comprador pode tentar de novo
  (cada tentativa gera um `payment` novo, e o índice único parcial impede dois pagamentos vivos).

### Expiração (job `expire-orders`)
Para cada pedido vencido: sincroniza o pagamento → se o Pix ainda está pendente, cancela no PSP →
sincroniza de novo → libera a reserva. Pagamentos de cartão em `PROCESSING/AUTHORIZED` seguram o
pedido até decisão do PSP.

### Pagamento tardio
Se o Pix é pago depois da expiração: tentamos vender do estoque disponível. Sem estoque, o pedido vai
para `REFUND_PENDING`, sem ingresso, e aparece no admin para reembolso (ADR-0003).

### Reembolso
```
Admin (refunds:create) → elegibilidade (pago; total bloqueado se já houve check-in)
 → refunds REQUESTED (1 em andamento por pagamento) → PSP refund (idempotency refund_<id>)
 → PROCESSING → getPayment() autoritativo → payment/order REFUNDED|PARTIALLY_REFUNDED
 → reembolso total: ingressos REFUNDED + capacidade devolvida ao lote → refund SUCCEEDED
```
Se o PSP não responder (timeout), o reembolso fica `REQUESTED` e é reenviado com **a mesma chave**,
então não há devolução em dobro. O banco nunca "declara" dinheiro devolvido sem o PSP confirmar.

Reembolso parcial não cancela ingressos automaticamente (fica a critério do admin). **Pendente de
definição de negócio:** em reembolso parcial, quanto da taxa de serviço a plataforma devolve. Hoje o
painel calcula o líquido do produtor como `total − taxa − reembolsado`, ou seja, o produtor absorve
o reembolso.

## Webhooks

`POST /api/webhooks/[provider]`
1. Lê o corpo cru e valida a assinatura **antes** de fazer o parse.
   - MP: `x-signature: ts=…,v1=…`, HMAC-SHA256 do manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`
     via `WebhookSignatureValidator` do SDK oficial.
   - Mock: `x-mock-signature: t=…,v1=HMAC(secret, t.body)`, com tolerância de 5 min (anti-replay).
2. Assinatura inválida → 401, nada persistido, log sem payload.
3. `INSERT … ON CONFLICT DO NOTHING` em `webhook_events(provider, dedupe_key)`. Duplicata → 200.
4. Processamento inline. Em falha → `FAILED` + `next_attempt_at` com backoff exponencial (15 s … 1 h,
   8 tentativas). O job `retry-webhooks` reprocessa.
5. Sempre responde 200 depois de persistir (o MP reenvia a cada 15 min se não receber 200/201 em 22 s).

Replay no MP: não aplicamos janela de tolerância no `ts`, porque os reenvios do MP podem manter a
assinatura original. Um replay é inofensivo, já que o estado sempre vem do `GET /v1/payments/{id}` e
a máquina de estados é idempotente.

Fallback: o job `sync-payments` consulta o PSP para pagamentos abertos há mais de 2 min.

## Integridade

`syncPaymentFromProvider` recusa aplicar um objeto do PSP cujo **valor** ou **external_reference**
não bata com o pagamento local. O pagamento é marcado com `failure_code = INTEGRITY_MISMATCH`, entra
na auditoria e aparece em vermelho em /admin/payments.

## Split

- **MVP:** single-account. A conta MP do Nosso After recebe o valor total. A "taxa da plataforma" é
  contabilizada (`fees`, `orders.fee_amount`), mas **não há repasse automático**, porque o produtor e a
  plataforma são a mesma entidade no primeiro cliente.
- **Multi-produtor (Fase 2):** Split 1:1 do MP. O produtor conecta a conta via OAuth, o pagamento é
  criado com o access token dele e `application_fee = fee_amount`. Falta: aplicação MP com
  marketplace habilitado, tabela `payment_accounts` com tokens OAuth **criptografados** (AES-256-GCM,
  chave fora do banco), refresh de token e UI de conexão. Nada de transferência manual nem saldo
  interno fictício.

## Checklist para SANDBOX / PRODUCTION

A integração com o Mercado Pago foi implementada contra a documentação e o SDK oficiais (3.6.1), mas
**ainda não foi executada contra a API real**. Antes de habilitar:

- [ ] Criar a aplicação em *Suas integrações* e obter as credenciais de **teste** (`MERCADOPAGO_*`).
- [ ] Configurar o webhook (tópico *Pagamentos*) para `https://<staging>/api/webhooks/mercadopago` e copiar a assinatura secreta.
- [ ] Em staging (`PAYMENT_PROVIDER=mercadopago`, `MERCADOPAGO_ENVIRONMENT=sandbox`): cartão aprovado (`APRO`), recusado (`OTHE`), parcelado, Pix, refund total e parcial.
- [ ] **Verificar** se o Pix da Payments API (`/v1/payments`) pode ser aprovado em sandbox. A doc só garante isso para a Orders API (`payer.first_name = "APRO"`). Se não puder, validar Pix com um valor mínimo em produção controlada ou avaliar a Orders API.
- [ ] Conferir se `date_of_expiration` do Pix é respeitado e se `cancelled/expired` chega por webhook.
- [ ] Conferir se `fee_details`/`net_received_amount` chegam como esperado (tarifa PSP no painel).
- [ ] Ativar as credenciais de produção (dados da conta, homologação do MP), `APP_ENV=production`.
- [ ] Revisar política de chargeback e as tarifas negociadas.
