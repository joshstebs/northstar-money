ALTER TABLE "Transaction" ADD COLUMN "userCategory" TEXT, ADD COLUMN "currency" TEXT;

CREATE TABLE "BalanceSnapshot" (
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "assets" DECIMAL(65,30) NOT NULL,
    "liabilities" DECIMAL(65,30) NOT NULL,
    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("userId", "day"),
    CONSTRAINT "BalanceSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IncomeSource" (
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    CONSTRAINT "IncomeSource_pkey" PRIMARY KEY ("userId", "sourceKey"),
    CONSTRAINT "IncomeSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "User" ADD COLUMN "budgetWarningPercent" INTEGER NOT NULL DEFAULT 80;

CREATE TABLE "GoalContribution" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GoalContribution_goalId_createdAt_idx" ON "GoalContribution"("goalId", "createdAt");

ALTER TABLE "Budget" ADD COLUMN "rollover" BOOLEAN NOT NULL DEFAULT false;
