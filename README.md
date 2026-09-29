# Nosso After — ticketing & payments

Plataforma própria de venda de ingressos do **Nosso After** (Guarujá/SP): site do evento, checkout,
API de pagamentos, pedidos, taxas, ingressos com QR Code, check-in e painel do produtor.
O processamento financeiro é feito por um PSP autorizado (Mercado Pago no MVP) através das APIs
oficiais dele, atrás de uma interface `PaymentProvider` que pode ser trocada. Multi-organização
desde o schema.

> **Status (Fase 1):** fluxo completo funcionando em **modo DEMO** (simulador de PSP local, sem
> dinheiro). A integração Mercado Pago está implementada, mas **não foi validada no sandbox real**
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

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento (em dev os jobs rodam no próprio processo a cada 30 s) |
| `npm run check` | typecheck + lint + testes |
| `npm test` | ~70 testes; os de integração sobem um Postgres descartável na porta 5434 |
| `npm run db:generate` | gera migration a partir de `src/server/db/schema.ts` |
| `npm run db:migrate` / `db:seed` | aplica migrations / seed (seed só em development) |
| `npm run jobs:run` | roda todos os jobs uma vez |

## Documentação

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): camadas, fluxos, decisões
- [PAYMENTS.md](docs/PAYMENTS.md): payment core, PSP, webhooks, refunds, checklist de produção
- [SECURITY.md](docs/SECURITY.md): controles implementados, LGPD, pendências
- [DATABASE.md](docs/DATABASE.md): modelo, invariantes, retenção
- [API.md](docs/API.md): endpoints
- [DEPLOYMENT.md](docs/DEPLOYMENT.md): ambientes, variáveis, cron, go-live
- [ADRs](docs/adr/): 0001 PSP · 0002 stack · 0003 estoque · 0004 confirmação de pagamento · 0005 auth/RBAC · 0006 QR · 0007 dinheiro/taxas

## Roadmap

**Fase 1 (esta entrega):** arquitetura, análise de PSP + ADRs, projeto, banco + migrations,
autenticação + RBAC, organizações, eventos, lotes, pedidos com estoque transacional, checkout,
abstração `PaymentProvider`, provider DEMO + adaptador Mercado Pago, webhooks, ingressos, check-in,
dashboard e reembolso (antecipado da Fase 2 porque faz parte do critério do MVP).

**Fase 2:** cupons, promoters, conciliação automática + settlements, relatórios/CSV, split
multi-produtor (OAuth MP), provedor de e-mail transacional, gestão de membros na UI, hardening
(WAF/Redis para rate limit, MFA), deploy de produção.
