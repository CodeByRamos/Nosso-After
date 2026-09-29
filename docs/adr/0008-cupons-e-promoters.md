# ADR-0008 — Cupons e promoters

- **Status:** Aceito · **Data:** 2026-09-29

## Cupons

- **Desconto por ingresso.** `PERCENTAGE` (basis points) ou `FIXED` (centavos), aplicado a cada
  ingresso elegível e limitado ao preço do ingresso. Todos os ingressos da mesma linha ficam com o
  mesmo preço final, sem sobra de centavos para ratear.
- **A taxa de serviço incide sobre o valor com desconto** (o que o comprador realmente paga pelo
  ingresso). Taxa por pedido usa o subtotal com desconto.
  *Alternativa rejeitada:* taxa sobre o preço cheio. Ela cobraria taxa sobre um desconto que o
  comprador não pagou. Se o negócio quiser, basta trocar `effective` por `unitPrice` em `computeQuote`.
- **Escopo:** organização (todos os eventos) ou um evento. Opcionalmente, alguns lotes (`coupon_batches`).
- **Contagem de uso atômica, igual ao estoque:** o pedido **reserva** um uso ao ser criado
  (`UPDATE … WHERE redeemed_count < max_redemptions` + `CHECK`), **confirma** quando é pago e
  **libera** quando expira. O limite por comprador é checado sob advisory lock (cupom + comprador).
- Um cupom inexistente, inativo, fora da validade ou de outro evento recebe **a mesma mensagem**,
  para que códigos não possam ser sondados.
- Pagamento tardio com o cupom já liberado: o uso é reconfirmado, porque o comprador pagou o preço com
  desconto. Se isso estourar o limite, o caso é registrado na linha do tempo (`COUPON_OVER_LIMIT_LATE_PAYMENT`).
- Reembolso **não** devolve o uso do cupom.
- Cupom de 100% gera total zero e é recusado. Ingresso gratuito exige outro fluxo, fora do escopo.

## Promoters

- Link `/r/<CODIGO>` → cookie `na_ref` **assinado pelo servidor** (HMAC com o id do promoter e a
  expiração), httpOnly, 30 dias, último clique vence.
- `POST /api/orders` lê **só o cookie**. O corpo da requisição não tem campo de promoter, então o
  front não consegue atribuir nem trocar a venda.
- Promoter inativo ou de outra organização é ignorado em silêncio: a atribuição nunca bloqueia uma compra.
- **Comissão** = `fixo × ingressos + % × (subtotal − desconto)`, limitada à receita de ingressos. A
  taxa de serviço fica fora da base. O valor é gravado no pedido (`promoter_commission_amount`) no momento da compra.
- **Comissão devida:** pedido `PAID` → integral; `PARTIALLY_REFUNDED` → proporcional ao que não foi
  reembolsado; `REFUNDED`, `EXPIRED` ou `CHARGEBACK` → zero.
- O pagamento de comissões é feito fora do sistema. A plataforma **não** faz repasse nem mantém saldo
  de promoter, apenas o relatório. Repasse automático, se um dia existir, tem que passar pelo split oficial do PSP.
