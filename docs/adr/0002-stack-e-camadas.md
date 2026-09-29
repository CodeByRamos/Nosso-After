# ADR-0002 — Stack e organização em camadas

- **Status:** Aceito · **Data:** 2026-09-28

## Decisão

- **Next.js 16 (App Router) + TypeScript estrito**, com Server Components para as páginas públicas e o admin.
- **PostgreSQL** como única fonte de verdade. Em produção pode ser Supabase, Neon, RDS ou outro Postgres
  gerenciado; o código só depende de `DATABASE_URL`.
- **Drizzle ORM** + `pg` (node-postgres). Escolhido em vez do Prisma porque:
  - o controle de estoque exige `UPDATE … WHERE … RETURNING` condicional, `SELECT … FOR UPDATE`,
    `SKIP LOCKED` e advisory locks, que o Drizzle expressa de forma tipada;
  - não há engine binária separada;
  - as migrations SQL geradas (`drizzle-kit generate`) são versionadas e revisáveis.
- **Zod** para validar toda entrada (HTTP, server actions, env).
- **Tailwind CSS v4** com componentes próprios. Não usamos shadcn no MVP: menos dependências e
  identidade visual própria no site público.
- **Vitest** para testes unitários e de integração. A integração roda contra um **PostgreSQL real**
  (`embedded-postgres`), porque concorrência e locks não podem ser testados com mocks.

## Camadas

```
src/app/**                 Presentation   (páginas, route handlers, server actions)
src/components/**          Presentation   (componentes React)
src/server/services/**     Application    (casos de uso: criar pedido, pagar, emitir ingresso…)
src/server/domain/**       Domain         (regras puras: taxas, máquinas de estado, dinheiro)
src/server/db/**           Infrastructure (schema Drizzle, conexão)
src/server/payments/**     Infrastructure (PaymentProvider + adaptadores de PSP)
src/server/lib/**          Infrastructure (logger, env, crypto, rate limit, auditoria)
src/validators/**          Contratos de entrada (Zod), compartilhados entre cliente e servidor
```

Regras:
- `src/app` não importa adaptadores de PSP, só `services`.
- `domain` não importa nada de infraestrutura (é testável sem banco).
- Só `src/server/payments/providers/<psp>/` importa o SDK do PSP.

## Por que não Supabase Auth

Supabase Auth exigiria um projeto Supabase ou Docker local, e não existe Docker nesta máquina de
desenvolvimento. Ver ADR-0005: autenticação própria, com sessões opacas no Postgres, é pequena,
auditável e roda em qualquer Postgres. O banco pode continuar sendo hospedado no Supabase.
