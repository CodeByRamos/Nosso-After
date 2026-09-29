# ADR-0006 — Formato do QR Code

- **Status:** Aceito · **Data:** 2026-09-28

## Decisão

Payload do QR: `NA1.<ticketId base64url>.<v>.<mac>`

- `ticketId`: UUID do ingresso, codificado em base64url (sem dado pessoal).
- `v`: `qr_version` do ingresso (incrementa na reemissão e invalida o QR antigo).
- `mac`: os primeiros 128 bits de `HMAC-SHA256(QR_SIGNING_SECRET, "NA1|" + ticketId + "|" + v)`, em base64url.

O backend valida o MAC em tempo constante **antes** de consultar o banco (QR forjado → `INVALID` sem
tocar no banco) e depois aplica o check-in atômico:

```sql
UPDATE tickets SET status='CHECKED_IN', checked_in_at=now()
 WHERE id=$1 AND event_id=$2 AND status='VALID' AND qr_version=$v RETURNING id;
```

Dois dispositivos lendo o mesmo ingresso ao mesmo tempo: só um `UPDATE` encontra `status='VALID'`.
Além disso, um índice único parcial em `check_ins(ticket_id) WHERE result='VALID'` garante isso no banco.

Todas as leituras, válidas ou não, ficam em `check_ins` com operador, dispositivo e horário.
