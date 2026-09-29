# ADR-0003 — Controle transacional de estoque (anti-overselling)

- **Status:** Aceito · **Data:** 2026-09-28

## Contexto

Dois compradores simultâneos não podem levar o último ingresso. O pedido reserva estoque por alguns
minutos enquanto o pagamento acontece.

## Decisão

Cada `ticket_batches` guarda `quantity`, `sold_quantity` e `reserved_quantity`, com a
`CHECK (sold_quantity + reserved_quantity <= quantity)`.

Para **reservar**, fazemos um único `UPDATE` condicional e atômico:

```sql
UPDATE ticket_batches
   SET reserved_quantity = reserved_quantity + $n
 WHERE id = $batch AND status = 'ACTIVE'
   AND quantity - sold_quantity - reserved_quantity >= $n
RETURNING id;
```

No Postgres (READ COMMITTED), `UPDATE`s concorrentes na mesma linha são serializados pelo lock de
linha, e a cláusula `WHERE` é reavaliada sobre a versão mais recente (EvalPlanQual). Se nenhuma linha
voltar, não há estoque. A `CHECK` é a segunda linha de defesa: mesmo um bug na aplicação não consegue
gravar overselling.

As transições de estoque do pedido (`RESERVED → COMMITTED | RELEASED`) acontecem com o pedido travado
(`SELECT … FOR UPDATE`) e são guardadas por `orders.inventory_status`. Assim, liberar ou confirmar
duas vezes é impossível, mesmo com webhook duplicado e job de expiração rodando ao mesmo tempo.

O limite por comprador (`max_per_customer`) é verificado sob `pg_advisory_xact_lock` na chave
(evento, e-mail), para que dois pedidos paralelos do mesmo comprador não passem juntos.

## Pagamento tardio

Um Pix pode ser pago depois que a reserva expirou. Nesse caso tentamos vender direto
(`sold_quantity + n` com a mesma condição de disponibilidade). Se não houver estoque, o pedido vai para
`REFUND_PENDING`, fica visível no admin e na conciliação, e o reembolso é feito pelo fluxo oficial.
Nunca emitimos ingresso acima da capacidade.

## Alternativas rejeitadas

- `SERIALIZABLE` em toda a transação: retries frequentes sob carga, sem ganho sobre o UPDATE condicional.
- Contar pedidos em aberto a cada compra: caro e sujeito a corrida sem lock.
- Redis para reservas: mais uma peça de infraestrutura e perda da atomicidade com o pedido.
