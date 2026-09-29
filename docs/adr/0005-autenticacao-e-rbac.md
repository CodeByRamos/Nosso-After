# ADR-0005 — Autenticação e RBAC

- **Status:** Aceito · **Data:** 2026-09-28

## Decisão

- **Compradores não precisam de conta.** O acesso ao pedido e aos ingressos usa um token por pedido:
  `HMAC-SHA256(ORDER_ACCESS_SECRET, "order-access:" + orderId)`, entregue em cookie httpOnly logo após
  a compra e por link no e-mail. O token não fica no banco e não expõe dados pessoais.
- **Equipe (admin, produtor, operador de check-in):** e-mail + senha.
  - Hash **scrypt** (N=2^15, r=8, p=1, salt de 16 bytes) com `node:crypto`, sem dependência nativa.
    Comparação em tempo constante.
  - Sessão opaca: 32 bytes aleatórios no cookie, `SHA-256(token)` no banco (`sessions.token_hash`).
    Um vazamento do banco não permite sequestrar sessões.
  - Cookie `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` fora de development. Expira em
    12 h, com renovação deslizante e revogação no logout.
  - Bloqueio temporário após falhas de login, mais rate limit por IP e por e-mail.
- **RBAC** em duas camadas:
  - papel de plataforma: `users.platform_role = SUPER_ADMIN`;
  - papel por organização: `memberships.role ∈ {ORGANIZATION_ADMIN, EVENT_MANAGER, CHECKIN_OPERATOR, PROMOTER}`;
  - permissões explícitas em `src/server/auth/permissions.ts`. Toda consulta administrativa é filtrada
    por `organization_id`, o que impede acesso entre organizações;
  - `CHECKIN_OPERATOR` só tem `checkin:*`. **Regras de taxa da plataforma** (`fees:manage`) só para `SUPER_ADMIN`.
- **CSRF:** mutações no admin usam Server Actions (o Next valida a Origin). As rotas `/api/*` com cookie
  exigem `Origin` igual ao host (checado no `proxy.ts`). Webhooks e cron ficam fora dessa checagem,
  porque são autenticados por assinatura ou segredo.

## Evolução

Se precisar de SSO ou MFA, dá para migrar para Better Auth ou Supabase Auth mantendo `users`,
`memberships` e as permissões.
