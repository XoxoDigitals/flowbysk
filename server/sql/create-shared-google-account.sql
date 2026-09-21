-- Create SharedGoogleAccount if missing (safe — does not drop data)
CREATE TABLE IF NOT EXISTS "SharedGoogleAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL DEFAULT 'https://flow.google.com',
  "email" TEXT,
  "password" TEXT,
  "totpSecret" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SharedGoogleAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SharedGoogleAccount_isActive_idx" ON "SharedGoogleAccount"("isActive");
