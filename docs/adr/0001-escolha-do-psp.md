# ADR-0001 — Escolha do PSP para o MVP

- **Status:** Aceito
- **Data:** 2026-09-28
- **Decisores:** Engenharia (plataforma Nosso After)

## Contexto

A plataforma precisa ter checkout, API de pagamentos, controle de pedidos, taxas, ingressos e conciliação
próprios. O **processamento financeiro** (captura, liquidação, split e devolução) é delegado a um
PSP / instituição de pagamento autorizada, através das APIs oficiais dele. Não construímos gateway, não
guardamos saldo de terceiros e não movimentamos dinheiro fora dos mecanismos do PSP.

O MVP precisa de:

| Requisito | Por quê |
|---|---|
| Pix com QR Code + copia e cola | principal meio de pagamento do público |
| Cartão de crédito com tokenização **no cliente** | não trafegar PAN/CVV pelos nossos servidores (escopo PCI mínimo) |
| Parcelamento | ticket médio de festa |
| Split oficial plataforma × produtor | taxa da plataforma sem movimentação manual |
| Webhooks assinados | confirmar pagamento sem confiar no frontend |
| Refund total e parcial via API | fluxo de reembolso |
| Chargeback visível via API/notificação | conciliação |
| Sandbox que permita **aprovar** Pix e cartão | testar o fluxo ponta a ponta |
| Onboarding viável para um produtor pequeno | o primeiro cliente é o próprio Nosso After |

## Opções avaliadas

Fontes: documentação oficial de cada PSP consultada em 2026-09-28 (links abaixo). Onde a documentação
não confirma algo, está marcado como **não verificado**. Não inventamos endpoints.

### Mercado Pago (Checkout Transparente — Payments API `/v1/payments` e Orders API `/v1/orders`)

- **Pix:** sim. Retorna `qr_code` (copia e cola), `qr_code_base64` e `ticket_url`; expiração configurável.
- **Cartão:** sim, tokenização no cliente com MercadoPago.js v2 / Card Payment Brick (os dados do cartão
  vão direto do navegador para o Mercado Pago; nosso backend recebe só o `token`). Parcelamento suportado.
- **Split:** sim, oficial — "Split de Pagamentos 1:1 (marketplace)": o produtor conecta a conta dele via
  **OAuth**, o pagamento é criado com o access token do produtor e a comissão da plataforma vai em
  `application_fee` (Payments API). O MP desconta a própria tarifa primeiro, depois a comissão da
  plataforma. Refunds são rateados proporcionalmente.
- **Webhooks:** assinados com HMAC-SHA256 no header `x-signature` (`ts=…,v1=…`), manifest
  `id:{data.id};request-id:{x-request-id};ts:{ts};`. O SDK oficial `mercadopago` (v3.6.1) traz
  `WebhookSignatureValidator`. Reenvio a cada 15 minutos se não houver 200/201 em até 22 s.
- **Idempotência:** header `X-Idempotency-Key` obrigatório na criação de pagamentos/orders.
- **Refund:** total e parcial via API; chargebacks via API e notificação.
- **Sandbox:** credenciais de teste + usuários de teste; cartões de teste com titular `APRO`/`OTHE` etc.
  Na Orders API, Pix de teste com `payer.first_name = "APRO"` é aprovado automaticamente.
  **Não verificado:** aprovação de Pix em sandbox na Payments API clássica.
- **Onboarding:** conta PF ou PJ; credenciais de produção exigem ativação no painel. Produtor precisa de
  conta Mercado Pago para o split.
- **SDK oficial Node:** `mercadopago` (npm).
- **Limitações:** marca Mercado Pago aparece no Brick; o produtor precisa ter conta MP; tarifas do MP
  variam por prazo de recebimento e são negociáveis; não verificado se a Orders API aceita marketplace fee.

### Pagar.me (Stone) — API v5 (`/core/v5`)

- **Pix / cartão / boleto:** sim. Tokenização no cliente via `tokenizecard.js` (token expira em 60 s).
- **Split:** sim, array `split` com `recipient_id`, `amount`, `type` (`flat`/`percentage`) e
  `options.liable/charge_processing_fee/charge_remainder_fee`. **A doc diz que o split é restrito a
  clientes PSP**, ou seja, depende de contrato comercial.
- **Recebedores:** criados via API (modelo marketplace clássico, bom para ticketeira), com KYC.
- **Webhooks:** configurados no painel. **Não confirmado na doc v5** o mecanismo de assinatura (a doc v4
  usava `X-Hub-Signature`). Precisaria de validação com a Pagar.me.
- **Onboarding:** exige CNPJ e aprovação comercial para o modelo PSP/split.
- **Leitura:** é a melhor opção de escala para uma ticketeira multi-produtor. Fica como segundo adaptador.

### Asaas — API v3

- **Pix / boleto / cartão:** sim. Split por `walletId` com `fixedValue`/`percentualValue`; subcontas via API.
- **Webhooks:** token de autenticação configurável (`asaas-access-token`), não HMAC.
- **Sandbox:** tem `POST /v3/sandbox/payment/{id}/confirm`.
- **Bloqueador:** a doc oficial diz que **o Asaas não oferece tokenização client-side** e recomenda que a
  aplicação seja certificada **PCI SAQ-D**, porque os dados do cartão passariam pelo nosso backend.
  Tokenização em produção também depende de aprovação do gerente de contas. Isso viola o requisito de
  nunca trafegar dados de cartão pelos nossos servidores. Pode ser usado **só para Pix** no futuro.

### Stripe (Brasil)

- Documentação, sandbox e webhooks excelentes; parcelamento para contas BR.
- **Bloqueador:** Pix para contas brasileiras é **invite-only** e exige no mínimo 60 dias de
  processamento na Stripe. Plataformas de fora do Brasil com contas conectadas brasileiras **não podem
  cobrar application fee**. Inviável para o MVP.

### Outros (não aprofundados no MVP)

Efí (Gerencianet), PagBank, Iugu, Zoop, Vindi e Cielo têm Pix e cartão; ficam para uma avaliação futura
se as tarifas do MP ou da Pagar.me não fecharem. A interface `PaymentProvider` permite adicioná-los.

## Matriz resumida

| Critério | Mercado Pago | Pagar.me v5 | Asaas | Stripe BR |
|---|---|---|---|---|
| Pix | ✅ | ✅ | ✅ | ⚠️ invite-only |
| Cartão tokenizado no cliente | ✅ Brick/MP.js | ✅ tokenizecard.js | ❌ (SAQ-D) | ✅ |
| Parcelamento | ✅ | ✅ | ✅ | ✅ |
| Split oficial | ✅ OAuth + `application_fee` | ✅ recebedores (contrato PSP) | ✅ walletId | ❌ para plataforma não-BR |
| Assinatura de webhook | ✅ HMAC documentado | ❓ v5 não confirmado | ⚠️ token estático | ✅ |
| Aprovar Pix no sandbox | ✅ (Orders API) | ❓ | ✅ | — |
| Onboarding para produtor pequeno | ✅ fácil | ⚠️ CNPJ + comercial | ✅ | ❌ |
| SDK Node oficial | ✅ | ⚠️ | ⚠️ | ✅ |

## Decisão

**Mercado Pago é o PSP do MVP**, integrado pela **Payments API (`/v1/payments`)** com o SDK oficial
`mercadopago`, porque é a API em que o split marketplace (`application_fee`) está documentado.

- Cartão: Card Payment Brick (tokenização no navegador). Nosso backend só recebe `token`,
  `payment_method_id`, `issuer_id`, `installments` e a identificação do pagador.
- Pix: `payment_method_id = "pix"` com `date_of_expiration` alinhado à expiração da reserva.
- Webhook: validado com `WebhookSignatureValidator` do SDK e, **sempre**, confirmado com
  `GET /v1/payments/{id}` antes de mudar estado (o payload do webhook nunca é fonte de verdade).
- Split: **modo single-account no MVP**, com a conta MP do próprio Nosso After recebendo tudo e sem
  split. O split marketplace (OAuth do produtor + `application_fee`) está modelado na interface
  (`capabilities.split`, campo `split` em `CreatePaymentInput`), mas **não está habilitado**. Para
  habilitar é preciso: (1) aplicação MP configurada para marketplace; (2) fluxo OAuth do produtor;
  (3) armazenar os tokens OAuth criptografados. Isso fica para a Fase 2.
- **Pagar.me** é o segundo adaptador planejado, para quando houver CNPJ + contrato PSP e vários produtores.

## Consequências

- O core (pedidos, estoque, taxas, ingressos, check-in, auditoria) não conhece o Mercado Pago. Só
  `src/server/payments/providers/mercadopago/*` importa o SDK.
- Para desenvolvimento local e testes existe o provider `mock` (ambiente **DEMO**), que simula um PSP
  com o mesmo pipeline: webhooks assinados (HMAC), consulta de status, refund. Ele **não** move dinheiro
  e não sobe em `APP_ENV=production`.
- A integração com o Mercado Pago está implementada contra a documentação e o SDK oficiais, mas
  **não foi validada contra o sandbox real**, porque faltam credenciais. Ver PAYMENTS.md, seção
  "Checklist para SANDBOX/PRODUCTION".

## Dependências externas (bloqueiam produção)

1. Conta Mercado Pago do Nosso After (PF/PJ) com credenciais de produção ativadas.
2. Aplicação criada em "Suas integrações", com a URL de webhook e o segredo de assinatura.
3. Para o split multi-produtor: aplicação marketplace + OAuth + termo comercial.
4. Confirmar com o MP as tarifas por prazo de recebimento e a política de chargeback do segmento de eventos.

## Referências

- Mercado Pago — Pix (Orders): https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
- Mercado Pago — Teste Pix: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix
- Mercado Pago — Split marketplace: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Mercado Pago — Notificações: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications
- SDK `mercadopago` 3.6.1 — `dist/utils/webhook/index.js` (`WebhookSignatureValidator`)
- Pagar.me — Split: https://docs.pagar.me/reference/split-1 · tokenizecard: https://docs.pagar.me/docs/tokenizecard
- Asaas — Tokenização/PCI: https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito · https://docs.asaas.com/docs/pci-dss-1
- Asaas — Split: https://docs.asaas.com/docs/split-de-pagamentos · Sandbox confirm: https://docs.asaas.com/reference/confirmar-pagamento
- Stripe — Pix no Brasil: https://support.stripe.com/questions/how-to-enable-pix-as-a-payment-method-in-brazil
