# Northstar Money

Private, read-only Canadian personal-finance dashboard with Plaid + Flinks connectivity, normalized transaction analytics and an optional AI advisor.

## Security model
- Private single-user password authentication; no public signup.
- HttpOnly, SameSite=Strict signed session cookie.
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
- Daily cron executes at 6 AM America/Toronto using paired UTC schedules to handle DST.

> Flinks no longer supports unattended nightly refresh for most Canadian institutions. When a bank requires user presence/MFA, Northstar will mark that connection for attention rather than claim an autonomous refresh succeeded.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local`.
3. Create a strong private app password and run `npm run auth:hash -- "your password"`; store only the output in `APP_AUTH_PASSWORD_HASH`.
4. Generate `APP_AUTH_SECRET` as a high-entropy random secret.
5. Generate a 32-byte base64 `APP_ENCRYPTION_KEY`; never rotate it without re-encrypting stored provider credentials.
6. Configure `DATABASE_URL`, then run `npx prisma generate && npx prisma db push`.
7. Configure Plaid and/or Flinks sandbox credentials first.
8. Configure `APP_URL`, `PLAID_WEBHOOK_SECRET`, and `CRON_SECRET` before enabling webhooks/cron.
9. Optional AI: set `OPENAI_API_KEY` and `OPENAI_MODEL` (default template uses `gpt-5.6-luna`).
10. `npm run build && npm run typecheck`, then `npm run dev`.

## Production checklist
- Keep the GitHub repository private.
- Use Vercel encrypted environment variables; never commit `.env.local`.
- Apply the Prisma schema to the production database before connecting a real institution.
- Start with Plaid Sandbox/Flinks test institution, then validate a real internal account before broader use.
- Whitelist the production `APP_URL` redirect domain with Flinks.
- Confirm Plaid webhook delivery and scheduled sync logs.
- Back up the database and the encryption key separately and securely.
- Review dependency audit findings before adding live credentials.

## AI/data handling
The AI advisor receives a normalized financial snapshot (metrics, categories, recurring candidates and recent transaction summaries), never Plaid/Flinks credentials. Advice is informational; Northstar never autonomously transfers money or executes investments.
