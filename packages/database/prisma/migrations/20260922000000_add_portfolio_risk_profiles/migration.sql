CREATE TYPE "PortfolioRiskTolerance" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

CREATE TABLE "portfolio_risk_profiles" (
    "id" TEXT NOT NULL,
    "chatConfigId" TEXT NOT NULL,
    "tolerance" "PortfolioRiskTolerance" NOT NULL DEFAULT 'BALANCED',
    "maxSinglePositionPercent" INTEGER NOT NULL DEFAULT 20,
    "maxSectorPercent" INTEGER NOT NULL DEFAULT 40,
    "maxTotalPaperNotionalCzk" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_risk_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portfolio_risk_profiles_chatConfigId_key" UNIQUE ("chatConfigId"),
    CONSTRAINT "portfolio_risk_profiles_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
