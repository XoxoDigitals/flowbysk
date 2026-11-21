-- Additive v5 cookie columns for SharedGoogleAccount (safe if already applied).
ALTER TABLE "SharedGoogleAccount" ADD COLUMN IF NOT EXISTS "cookieExportEnc" TEXT;
ALTER TABLE "SharedGoogleAccount" ADD COLUMN IF NOT EXISTS "cookieVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SharedGoogleAccount" ADD COLUMN IF NOT EXISTS "cookieMeta" JSONB;
