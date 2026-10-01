# DEPLOYMENT

## Ambientes

| | development | staging | production |
|---|---|---|---|
| `APP_ENV` | development | staging | production |
| Pagamentos | `mock` (DEMO) ou MP sandbox | MP **sandbox** (ou mock) | MP **production** |
| Banco | Postgres local (embedded/Docker) | Postgres gerenciado próprio | Postgres gerenciado próprio, backups + PITR |
| Jobs | no próprio processo (30 s) | cron externo | cron externo |
| robots | `Disallow: /` | `Disallow: /` | indexa o site público |
| Seed | `npm run db:seed` | ❌ | ❌ |

Nunca reutilize segredos entre ambientes. Credencial MP de produção com `APP_ENV` diferente de
production faz o boot falhar, e o provider `mock` com `APP_ENV=production` também.

## Variáveis

Ver `.env.example` (nomes, sem valores). Obrigatórias: `DATABASE_URL`, `APP_URL` (https em prod),
`QR_SIGNING_SECRET`, `ORDER_ACCESS_SECRET`, `CRON_SECRET` (≥ 32 caracteres cada),
`MFA_ENCRYPTION_KEY` (32 bytes base64url, staging/produção), `REQUIRE_MFA` (produção: padrão `admins`), `PAYMENT_PROVIDER`
e as credenciais do provider escolhido. Opcionais: `DB_POOL_MAX`, `DB_CONNECT_TIMEOUT_MS`,
`ORDER_RESERVATION_MINUTES`, `LOG_LEVEL`.

## Hospedagem sugerida

Qualquer plataforma Node com Next.js 16 (Vercel, Render, Fly, AWS). Requisitos:
- **Proxy confiável** que sobrescreva `X-Forwarded-For` (usado no rate limit e na auditoria).
- Postgres com pool (ex.: PgBouncer/Supavisor em modo transaction). O app usa `SELECT … FOR UPDATE`
  e advisory locks **dentro de transações**, o que é compatível com pooling em modo transaction.
- Supabase/Neon/RDS funcionam, porque o código só depende de `DATABASE_URL`.

## Deploy

```bash
npm ci
npm run check          # typecheck + lint + testes (CI: defina TEST_DATABASE_URL para um Postgres de serviço)
npm run db:migrate     # com DATABASE_URL do ambiente, ANTES de subir a nova versão
npm run build && npm start
```
Migrations são aditivas (expand/contract) para permitir deploy sem downtime.

## Cron

Chame a cada minuto (ex.: Vercel Cron, GitHub Actions, cron do provedor):
```
POST {APP_URL}/api/cron/expire-orders    Authorization: Bearer $CRON_SECRET
POST {APP_URL}/api/cron/retry-webhooks
POST {APP_URL}/api/cron/sync-payments
POST {APP_URL}/api/cron/deliver-emails
```
A cada 15 minutos: `POST /api/cron/reconcile` (conciliação).
Uma vez por hora: `POST /api/cron/housekeeping` (limpeza + retenção LGPD).

## Webhook do PSP

Mercado Pago → *Suas integrações* → Webhooks → URL `https://<host>/api/webhooks/mercadopago`, tópico
**Pagamentos** (e Chargebacks). Copie a assinatura secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
Para testar localmente com o sandbox, exponha o dev server por um túnel (ex.: cloudflared) e use essa URL.

## Monitoramento mínimo para go-live

- Uptime em `/api/health`.
- Alerta para `webhook_events` com status FAILED > 0 por mais de 15 min.
- Alerta para `payments.failure_code = 'INTEGRITY_MISMATCH'`.
- Alerta para pedidos em `REFUND_PENDING`.
- Error tracking (Sentry): ainda não integrado; o gancho é `onRequestError` em `src/instrumentation.ts`.
- Alerta para `reconciliation_issues` com severidade CRITICAL abertas.

## Go-live checklist

- [ ] Checklist de PAYMENTS.md concluído em staging com o sandbox real.
- [ ] Termos e privacidade revisados pelo jurídico; dados do controlador/DPO publicados.
- [ ] Provedor de e-mail transacional configurado (hoje os e-mails ficam em `email_outbox`).
- [ ] `MFA_ENCRYPTION_KEY` gerada e guardada no secrets manager (perdê-la invalida todos os MFA).
- [ ] Seed de produção feito manualmente (sem `db:seed`); admins ativam MFA no 1º acesso.
- [ ] Logo oficial em SVG e artes em storage próprio (ver BRAND.md §6).
- [ ] Backups testados (restore).
- [ ] Teste de carga do checkout no pico esperado de abertura de lote.
