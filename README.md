# Northstar Money
Private, read-only Canadian personal-finance dashboard with Plaid + Flinks provider adapters and an AI-advisor architecture.

## MVP implemented
- Responsive overview dashboard
- Plaid Canada Link-token endpoint and public-token exchange
- Flinks Authorize Token / Connect entry point
- PostgreSQL/Prisma schema for users, connections, accounts, transactions, budgets, goals and insights
- AI insights endpoint placeholder
- Read-only security model

## Setup
1. Copy `.env.example` to `.env.local`.
2. Add PostgreSQL, Plaid and Flinks credentials.
3. `npm install`
4. `npx prisma generate && npx prisma db push`
5. `npm run dev`

Never commit `.env.local`. Provider access tokens must be encrypted before persistence. Production should add private authentication before bank connections are enabled.

## Next build slice
- Persist encrypted provider tokens
- Plaid `/transactions/sync` + webhook ingestion
- Flinks `/GetAccountsDetail` ingestion
- transaction normalization/deduplication
- recurring-payment detection
- real AI analysis over normalized data
- scheduled daily sync and weekly financial brief
- private authentication and audit log
