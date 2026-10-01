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

## Fase 2 — controles adicionados

| Área | Implementação |
|---|---|
| MFA | TOTP (RFC 6238) com `node:crypto`. Segredo cifrado com AES-256-GCM (`MFA_ENCRYPTION_KEY`), 8 códigos de recuperação de uso único guardados como SHA-256, anti-replay por janela de tempo (login e desativação), desafio de login em cookie assinado de 5 min com `path=/login`. Política `REQUIRE_MFA` (produção: `admins` por padrão; `none` proibido). Quem está sem MFA obrigatório só acessa `/conta` |
| Membros | Senha provisória com troca obrigatória (outras sessões revogadas na troca), a organização nunca fica sem admin, ninguém altera o próprio acesso, tudo auditado |
| Cupons | Validação só no servidor; mesma mensagem para código inexistente, inativo ou expirado (não dá para sondar); contagem de uso atômica com `CHECK` |
| Promoters | Atribuição apenas por cookie httpOnly **assinado** pelo servidor; o corpo da requisição não carrega promoter |
| Relatórios | CSV por permissão e por organização, auditado, com proteção contra injeção de fórmula (`=`, `+`, `-`, `@`) |
| LGPD | Exportação JSON do titular e anonimização irreversível (bloqueada com obrigação em aberto; registros financeiros mantidos), ambas auditadas; o link de acesso ao pedido sai da fila de e-mail após o envio |
| Retenção | Job `housekeeping`: IP de pedidos e check-ins após 180 dias, sessões após 30 dias, payload de webhook após 1 ano, e-mails enviados após 90 dias |
| Erros | `onRequestError` registra toda exceção não tratada em log estruturado e redigido |

## Pendências conhecidas (antes de produção)

1. Convites por e-mail para membros (hoje o admin define uma senha provisória, trocada no 1º acesso).
2. Rate limit no edge (WAF/Cloudflare) além do Postgres.
3. Restringir os hosts de imagem no CSP quando as artes tiverem storage próprio (hoje `img-src https:`).
4. Rotação de `QR_SIGNING_SECRET` com suporte a duas chaves (kid) para não invalidar ingressos emitidos.
5. Criptografia de tokens OAuth do PSP (quando o split marketplace for implementado).
6. Error tracking (Sentry) + alertas de `webhook_events.FAILED`, `INTEGRITY_MISMATCH` e pendências de conciliação.
7. Pentest externo antes do go-live. (`npm audit --audit-level=high` já roda no CI.)

## Reportar vulnerabilidade

Envie para o e-mail de segurança da produção (a definir). Não abra issue pública.
