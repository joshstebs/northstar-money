# Northstar Money production runbook

## 1. Provision PostgreSQL
Use a private managed PostgreSQL database. Vercel Marketplace Neon is the preferred path for this project.

Set `DATABASE_URL` only in the deployment environment. Do not commit it.

Apply the committed schema with:

```bash
npm ci
npm run db:generate
npm run db:migrate
```

Do not use `prisma db push` in production.

## 2. Generate app secrets
Configure the following as encrypted deployment environment variables:

- `APP_URL` — exact HTTPS production origin
- `APP_AUTH_SECRET` — high-entropy random secret, at least 32 characters
- `APP_AUTH_PASSWORD_HASH` — output of `npm run auth:hash -- "<private password>"`
- `APP_ENCRYPTION_KEY` — exactly 32 random bytes encoded as base64
- `CRON_SECRET` — independent high-entropy random secret

Run `npm run config:check` against the intended environment before connecting financial institutions.

Never rotate `APP_ENCRYPTION_KEY` after bank connections exist unless stored provider credentials are re-encrypted first.

## 3. Configure providers
Start with provider test/sandbox credentials.

### Plaid
Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and webhook configuration. Confirm Link completes, the access token is encrypted in the database, `/transactions/sync` imports accounts/transactions, and webhook updates are processed.

### Flinks
Set `FLINKS_INSTANCE`, `FLINKS_CUSTOMER_ID`, `FLINKS_AUTH_KEY`, `FLINKS_API_SECRET`, and `FLINKS_BASE_URL`. Whitelist the exact production callback origin. Confirm Connect completes and imported data is normalized into the same Account/Transaction tables.

## 4. Optional AI advisor
Set `OPENAI_API_KEY` and `OPENAI_MODEL`. The advisor receives normalized financial summaries only; provider credentials and banking tokens must never be included in prompts.

## 5. Deployment verification
After deployment:

1. `GET /api/health` must return HTTP 200 with `status: "ok"` and `database: "ok"`.
2. Sign in with the private owner password.
3. Connect a provider sandbox/test institution first.
4. Confirm accounts and transactions appear once, with no duplicate transactions.
5. Trigger manual sync and confirm idempotency.
6. Confirm budgets, goals, recurring review, anomaly review and debt planner read live normalized data.
7. Ask the AI advisor a question and confirm no credential material appears in request/log data.
8. Confirm scheduled 6 AM America/Toronto sync executes and audit logs record the run.
9. Only then authorize a real Canadian institution.

## 6. Failure policy
The app is fail-closed. Missing credentials, failed database access, provider MFA/re-authentication, or sync errors must produce an explicit degraded/attention state. Never display a successful connection or refresh unless persistence and ingestion succeeded.
