# Nosso After — ticketing & payments

Plataforma própria de venda de ingressos do **Nosso After** (Guarujá/SP): site do evento, checkout,
API de pagamentos, pedidos, taxas, ingressos com QR Code, check-in e painel do produtor.
O processamento financeiro é feito por um PSP autorizado (Mercado Pago no MVP) através das APIs
oficiais dele, atrás de uma interface `PaymentProvider` que pode ser trocada. Multi-organização
desde o schema.

> **Status (Fases 1 e 2):** fluxo completo funcionando em **modo DEMO** (simulador de PSP local, sem
> dinheiro), mais cupons, promoters, conciliação, relatórios, MFA, LGPD e a identidade visual da marca.
> A integração Mercado Pago está implementada, mas **não foi validada no sandbox real**
> (faltam credenciais). Veja [docs/PAYMENTS.md](docs/PAYMENTS.md#checklist-para-sandbox--production).

## Stack

Next.js 16 (App Router) · TypeScript estrito · PostgreSQL · Drizzle ORM · Zod · Tailwind v4 ·
Vitest (integração contra Postgres real) · SDK oficial `mercadopago`.

## Rodando localmente

Pré-requisitos: Node ≥ 22. Não precisa de Docker: o Postgres local roda via `embedded-postgres`
(binários oficiais). Se preferir Docker, use `docker compose up -d`.

```bash
npm install
cp .env.example .env.local   # preencha os segredos (comando para gerar está no arquivo)
npm run db:start             # terminal 1 — Postgres em localhost:5433
npm run db:migrate
npm run db:seed              # org Nosso After, admin, operador de portaria, evento de exemplo
npm run dev                  # terminal 2 — http://localhost:3000
```

> O simulador de PSP (modo DEMO) envia o webhook para `APP_URL`. Se o dev server subir em outra
> porta, ajuste `APP_URL` no `.env.local`, senão o pagamento simulado não confirma sozinho.

As credenciais de login do seed são as `SEED_*` do seu `.env.local`.

### Roteiro do MVP (modo DEMO)

1. `/` → **Nosso After** → escolha lote e quantidade → **Comprar**.
2. Dados → Pix ou cartão → revisão (taxa de serviço discriminada) → **Confirmar e pagar**.
3. **Pix:** a página do pedido mostra QR, copia e cola e contador. Clique em *Simular pagamento do Pix
   (DEMO)*: o simulador aprova e envia um **webhook assinado**, que passa pelo pipeline real
   (assinatura → dedupe → leitura autoritativa → PAID → ingressos).
   **Cartão (DEMO):** escolha "aprovar" ou "recusar". Nenhum dado de cartão é digitado.
4. Os ingressos aparecem com QR Code (também enviados para a outbox de e-mail; em dev o link sai no log).
5. `/login` → `/checkin` → evento → leia o QR com a câmera (ou cole o conteúdo) → **ENTRADA
   LIBERADA**. Uma segunda leitura retorna **JÁ UTILIZADO**.
6. `/admin` → venda, taxa, receita bruta/líquida; `/admin/orders/<id>` → **Reembolsar** (total ou
   parcial). O reembolso passa pelo PSP e aparece no pedido, em Pagamentos e na linha do tempo.
7. **Fase 2:** `/admin/coupons` (crie um cupom e aplique na revisão do checkout), `/admin/promoters`
   (abra `/r/CODIGO` antes de comprar: a venda é atribuída), `/admin/reports` (conciliação + CSV),
   `/admin/members`, `/admin/customers` (LGPD), `/conta` (senha e MFA), `/promoter` (vendas do promoter).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento (em dev os jobs rodam no próprio processo a cada 30 s) |
| `npm run check` | typecheck + lint + testes |
| `npm test` | ~100 testes; os de integração sobem um Postgres descartável na porta 5434 |
| `npm run db:generate` | gera migration a partir de `src/server/db/schema.ts` |
| `npm run db:migrate` / `db:seed` | aplica migrations / seed (seed só em development) |
| `npm run jobs:run` | roda todos os jobs uma vez |

## Documentação

- [BRAND.md](docs/BRAND.md): análise da identidade visual, público, tokens e decisões de design
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): camadas, fluxos, decisões
- [PAYMENTS.md](docs/PAYMENTS.md): payment core, PSP, webhooks, refunds, checklist de produção
- [SECURITY.md](docs/SECURITY.md): controles implementados, LGPD, pendências
- [DATABASE.md](docs/DATABASE.md): modelo, invariantes, retenção
- [API.md](docs/API.md): endpoints
- [DEPLOYMENT.md](docs/DEPLOYMENT.md): ambientes, variáveis, cron, go-live
- [ADRs](docs/adr/): 0001 PSP · 0002 stack · 0003 estoque · 0004 confirmação de pagamento · 0005 auth/RBAC · 0006 QR · 0007 dinheiro/taxas · 0008 cupons e promoters

## Roadmap

**Fase 1 (pronta):** arquitetura, análise de PSP + ADRs, banco + migrations, autenticação + RBAC,
organizações, eventos, lotes, pedidos com estoque transacional, checkout, abstração `PaymentProvider`,
provider DEMO + adaptador Mercado Pago, webhooks, ingressos, check-in, dashboard e reembolso.

**Fase 2 (pronta):** cupons, promoters (link `/r/CODIGO` + comissão), conciliação automática,
relatórios CSV, gestão de membros, MFA (TOTP), direitos do titular (LGPD), job de retenção, CI no
GitHub Actions e identidade visual do Nosso After ([BRAND.md](docs/BRAND.md)).

**Próximo:** validar o Mercado Pago no sandbox real, provedor de e-mail transacional, logo oficial em
SVG, upload das artes para storage próprio, settlements (relatório de liberações do PSP), split
multi-produtor (OAuth MP), Sentry/alertas, rate limit no edge e deploy de produção.
