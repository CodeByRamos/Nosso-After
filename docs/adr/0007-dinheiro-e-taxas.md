# ADR-0007 — Representação monetária e regras de taxa

- **Status:** Aceito · **Data:** 2026-09-28

## Decisão

- Valores sempre em **centavos inteiros** (`integer` no Postgres, inteiro no TS validado com
  `Number.isSafeInteger`). Nada de float em cálculo. A conversão para reais (`/100`) só acontece na
  borda com o PSP (o MP espera `transaction_amount` decimal) e na formatação da UI.
- Percentuais em **basis points** (`percentage_bps`, 790 = 7,90%), com arredondamento *half-up* por item.
- A taxa da plataforma vem de `fee_rules` (nada fixo no código): `fixed_amount`, `percentage_bps`,
  `payment_method`, `event_id`, `organization_id`, `applies_per` (TICKET | ORDER), `active_from`,
  `active_until`, `priority`.
- Resolução: vale a regra ativa **mais específica** (evento > organização > global; método específico >
  qualquer método). Empate: maior `priority`, depois a mais recente.
- A taxa calculada é gravada no pedido (`order_items.unit_fee`, `orders.fee_amount`) e em `fees`, com
  referência à regra usada, como snapshot auditável. Mudar a regra depois não altera pedidos antigos.
- A taxa aparece discriminada para o comprador antes da confirmação (quote → revisão).
- Sem regra ativa, a taxa é zero. Isso é explícito e aparece no admin como aviso.
