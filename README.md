# Northstar Money

Private, read-only Canadian personal-finance dashboard with Plaid + Flinks connectivity, normalized transaction analytics and an optional AI advisor.

## Implemented personal-finance features
- Live connected account and credit-card balances (no demo totals in production UI).
- Automatic transaction normalization from Plaid and Flinks.
- Monthly spending/income/cash-flow metrics and category baselines.
- Data-derived savings opportunities, recurring-payment review and unusual-spend flags.
- Monthly category budgets and savings goals.
- Debt avalanche ordering after the owner enters APR and optional minimum-payment data.
- Natural-language AI questions using normalized financial summaries, never bank tokens.
- Persisted weekly and monthly financial briefs.
- Manual refresh plus scheduled 6 AM America/Toronto synchronization.

## Security model
- Private single-user password authentication; no public signup.
- HttpOnly, SameSite=Strict signed session cookie and same-origin enforcement on authenticated write requests.
- Plaid access tokens and Flinks loginIds encrypted at rest with AES-256-GCM before database persistence.
- Provider credentials and app secrets are environment variables only and are ignored by Git.
- Read-only financial connectivity: the app has no transfer, payment or trading endpoints.
- Audit log for connection creation and synchronization events.

## Live data pipeline
- Plaid Link configured for Canada and up to 730 days of Transactions history.
- `/transactions/sync` cursor pipeline handles added, modified and removed transactions.
- Plaid `SYNC_UPDATES_AVAILABLE` webhook triggers incremental sync.
- Flinks Connect uses server-generated authorize tokens and returns to `/api/flinks/complete`.
- Flinks durable loginId is encrypted; fresh RequestIds are created server-side for aggregation.
- Flinks `/GetAccountsDetail` plus `202` polling through `/GetAccountsDetailAsync` is supported.
- Accounts and transactions from both providers are normalized into the same Prisma models.

> Flinks no longer supports unattended nightly refresh for most Canadian institutions. When a bank requires user presence/MFA, Northstar marks that connection for attention rather than claiming an autonomous refresh succeeded.

## Setup
1. `npm ci`
2. Copy `.env.example` to `.env.local`.
3. Create a strong private app password and run `npm run auth:hash -- "your password"`; store only the output in `APP_AUTH_PASSWORD_HASH`.
4. Generate `APP_AUTH_SECRET` as a high-entropy random secret.
5. Generate a 32-byte base64 `APP_ENCRYPTION_KEY`; never rotate it without re-encrypting stored provider credentials.
6. Configure `DATABASE_URL`, then run `npx prisma generate && npx prisma db push`.
7. Configure Plaid and/or Flinks sandbox credentials first.
8. Configure `APP_URL`, `PLAID_WEBHOOK_SECRET`, and `CRON_SECRET` before enabling webhooks/cron.
9. Optional AI: set `OPENAI_API_KEY` and `OPENAI_MODEL`.
10. `npm run typecheck && npm run build`, then `npm run dev`.

## Production checklist
- Keep the GitHub repository private.
- Use Vercel encrypted environment variables; never commit `.env.local`.
- Apply the Prisma schema to the production database before connecting a real institution.
- Start with Plaid Sandbox/Flinks test institution, then validate a real internal account before broader use.
- Whitelist the production `APP_URL` redirect domain with Flinks.
- Confirm Plaid webhook delivery and scheduled sync logs.
- Back up the database and the encryption key separately and securely.
- Review dependency audit findings before adding live credentials.

## Verification
GitHub Actions must pass `npm ci`, `prisma generate`, TypeScript typecheck and the production Next.js build before merge. Live financial connectivity is only considered verified after the owner supplies valid provider credentials and explicitly authorizes a real/test institution; the project never fabricates banking success.
