# NorthStar Money production runbook

## PostgreSQL

Keep the production `DATABASE_URL` in Vercel. Apply committed migrations before routing traffic to a release that uses the new schema.

```sh
npm ci
npm run db:generate
npm run db:migrate
```

Use a separate database for local testing and avoid running smoke-test writes on the production household. Verify `GET /api/health` returns HTTP 200 and reports the new commit after deployment.

## Household sign-in

The owner and spouse have independent passwords and use the same private household data. Configure the existing `APP_AUTH_SECRET` and `APP_AUTH_PASSWORD_HASH` plus an optional `APP_SPOUSE_PASSWORD_HASH` as sensitive environment variables. The password hash utility is `npm run auth:hash`. Redeploy after setting a new hash. Give each household member their own private password. Sessions expire after 12 hours.

Keep the existing `APP_ENCRYPTION_KEY` and `CRON_SECRET` intact. Changing the encryption key requires re-encrypting saved bank connections.

## Bank connections and statement imports

- **Plaid** uses the Canadian Transactions product. Search for the issuer in the production Link window and authorize only the accounts you want NorthStar to read. A successful build or a provider listing does not establish a working live bank connection.
- **Flinks** requires `FLINKS_INSTANCE`, `FLINKS_CUSTOMER_ID`, `FLINKS_AUTH_KEY`, `FLINKS_API_SECRET`, and `FLINKS_BASE_URL`. Configure the app origin for the embedded Connect iframe. After consent, NorthStar sends the connection identifier to its authenticated API and stores it encrypted.
- **PC Financial Mastercard** provides a CSV export in online transaction activity. **Canadian Tire Bank Mastercard** exports Quicken QFX or Microsoft Money OFX in the online statement-period view.
- Open the home page, then choose **Import a credit-card statement**. Enter the issuer and last four digits, then preview the file before importing. Generic CSVs need Date, Description, and Amount, or Date, Description, Debit, and Credit. Confirm the date and amount conventions. Use one file format per card and avoid importing a live-connected card. Statement imports supply activity only. A separate manual liability can record the current balance if you use file imports.
- When a provider requires MFA or reconnection, the connection should show **Needs attention**. Confirm pending and posted items are counted once after a successful refresh.

## Advice and reporting

`/advice` covers the household overview, net worth, budgets and goals. `/insights` adds six- and twelve-month views, category and merchant detail, and payroll review. Reporting uses posted CAD activity and recognized income. Internal transfers and card payments are excluded. Refunds reduce net spending. Unknown credits are flagged for review.

Scheduled refresh records dated balance snapshots. Net-worth history grows from those snapshots. Add only manual balances that are absent from your connected accounts. Use recorded goal contributions to establish a savings pace.

The weekly brief and observations work from recorded data without an AI service. To allow automatic AI summaries, set `AI_WEEKLY_BRIEF_ENABLED=true` with the existing `OPENAI_API_KEY` and `OPENAI_MODEL`. The weekly job supplies aggregates only. The separate Ask AI button sends the user's question and aggregate figures after they submit it.

## Release checks

1. Apply the additive migration and confirm the schema is ready.
2. Run the unit tests, TypeScript check, and production build.
3. Check login, logout, and anonymous denial on the preview.
4. With test credentials and synthetic data, verify the brief, import and re-import, category correction, net worth, budget and goal edits on desktop and phone layouts.
5. Confirm the production health route reports the new commit and the household pages require sign-in.
6. Verify real bank linking and synchronization after the household member authorizes the connection.
