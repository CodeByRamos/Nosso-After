# SECURITY

## Controles implementados

| Área | Implementação |
|---|---|
| Dados de cartão | Nunca recebidos. Tokenização no navegador pelo PSP (Brick). Guardamos só bandeira + 4 últimos dígitos (`CHECK` regex). Logger mascara sequências parecidas com PAN |
| Autenticação | Senha scrypt (N=2^15), sessão opaca (hash SHA-256 no banco), cookie `HttpOnly` + `SameSite=Lax` + `Secure` + `__Host-` fora de dev, TTL de 12 h com renovação deslizante, logout revoga |
| Força bruta | Rate limit por IP (20/15 min) e por e-mail (10/15 min), bloqueio de 15 min após 5 falhas, tempo constante para e-mail inexistente (hash dummy) |
| Autorização | RBAC (`auth/permissions.ts`). Toda consulta admin é filtrada por `organization_id`. `CHECKIN_OPERATOR` só faz check-in. Taxas da plataforma só `SUPER_ADMIN`. Recurso de outra organização → 404 |
| Compradores | Sem conta. Acesso ao pedido por HMAC em cookie httpOnly. Link do e-mail troca o token por cookie e redireciona (token sai da URL). Pedido sem acesso → 404 (não dá para sondar ids) |
| CSRF | Server Actions (verificação de Origin do Next) + `proxy.ts` exige `Origin == Host` em mutações `/api/*` (exceto webhooks e cron, que usam assinatura/segredo) |
| XSS | React escapa por padrão. CSP com nonce + `strict-dynamic` e sem `unsafe-inline` para scripts. `dangerouslySetInnerHTML` só em SVG de QR gerado por nós e em JSON-LD com `<` escapado |
| Injeção SQL | Drizzle com parâmetros. SQL cru só via template `sql\`\`` parametrizado |
| Validação | Zod em toda entrada (API, actions, env). Limite de tamanho de body |
| Headers | HSTS, X-Frame-Options DENY, frame-ancestors 'none', nosniff, Referrer-Policy (no-referrer em /pedido), Permissions-Policy, COOP, `X-Robots-Tag: noindex` em áreas privadas |
| Webhooks | HMAC verificado antes do parse, dedupe, estado relido do PSP, anti-replay (mock: janela de 5 min; MP: replay inofensivo por design) |
| Idempotência | `Idempotency-Key` obrigatória em pedidos, pagamentos e reembolsos. Chaves derivadas enviadas ao PSP |
| Rate limiting | Postgres (vale para todas as instâncias): pedidos, pagamentos, *card testing* (5 por pedido por hora), check-in, login, quote |
| Auditoria | `audit_logs` append-only por trigger (UPDATE/DELETE/TRUNCATE bloqueados), com ator, IP, user-agent, request-id e valor |
| Segredos | Só em variáveis de ambiente, validadas no boot. Credencial de produção fora de produção = boot falha. `.env*` no `.gitignore` |
| QR Code | Sem dado pessoal. MAC HMAC-128, versão para revogação. Verificado antes de tocar o banco |
| Logs | JSON, redação de password/token/secret/cvv/card/signature/cookie/authorization, CPF mascarado |

## LGPD

- **Minimização:** compra pede nome, e-mail e celular. CPF é **opcional** (só repassado ao PSP para
  identificar o pagador). O cartão fica no PSP. Opt-in de marketing separado e desmarcado por padrão.
- **Separação de finalidades:** compra (`customers`, `orders`), comunicação (`customers.marketing_opt_in`,
  `email_outbox`), operação (`tickets.holder_*`, `check_ins`), segurança (`orders.ip`, `sessions`, `audit_logs`).
- **Retenção (política proposta, validar com o jurídico):**
  - pedidos, pagamentos e reembolsos: 5 anos (obrigações fiscais e contábeis, contestações);
  - `orders.ip`: 180 dias;
  - `sessions`: removidas 30 dias após expirar;
  - `webhook_events.payload`: 1 ano;
  - `idempotency_keys`: 48 h (job `housekeeping`); `rate_limits`: 1 dia.
- **Direitos do titular:** `customers.anonymized_at` já existe. A anonimização (nome/e-mail/telefone/CPF
  substituídos, mantendo os registros financeiros) e a exportação de dados ficam na Fase 2, com
  endpoint autenticado e registro em auditoria.
- Termos e política de privacidade publicados como **rascunho técnico**, pendentes de revisão jurídica.

## Pendências conhecidas (antes de produção)

1. MFA para `SUPER_ADMIN` / `ORGANIZATION_ADMIN`.
2. Tela de gestão de membros e convites (hoje via seed/SQL).
3. Rate limit no edge (WAF/Cloudflare) além do Postgres.
4. Rotação de `QR_SIGNING_SECRET` com suporte a duas chaves (kid) para não invalidar ingressos emitidos.
5. Criptografia de tokens OAuth do PSP (quando o split marketplace for implementado).
6. Error tracking (Sentry) + alertas de `webhook_events.FAILED` e `INTEGRITY_MISMATCH`.
7. Pentest e revisão de dependências (npm audit) no pipeline de CI.

## Reportar vulnerabilidade

Envie para o e-mail de segurança da produção (a definir). Não abra issue pública.
