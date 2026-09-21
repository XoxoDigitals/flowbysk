-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN', 'RESELLER');

-- CreateEnum
CREATE TYPE "AcquiredVia" AS ENUM ('SIGNUP', 'ADMIN_MANUAL', 'RESELLER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('GRANT', 'RESERVE', 'SETTLE', 'RELEASE', 'DEDUCT', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IN_QUEUE', 'PREPARING', 'GENERATING', 'RETRYING', 'CHECKING_STATUS', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('HEALTHY', 'PAUSED', 'RATE_LIMITED', 'CREDENTIALS_EXPIRED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "CreditClassification" AS ENUM ('CREDITS_AVAILABLE', 'CREDITS_EXHAUSTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "NoticeSeverity" AS ENUM ('INFO', 'WARNING', 'SUCCESS');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('STRIPE', 'MANUAL_BANK', 'RESELLER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogCategory" AS ENUM ('AUTH', 'GENERATION', 'BILLING', 'SYSTEM', 'SECURITY_ALERT');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "StudioLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'DEBUG');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lastIp" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "assignedProviderAccountId" TEXT,
    "providerAssignmentManual" BOOLEAN NOT NULL DEFAULT false,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "ownedByAdminId" TEXT,
    "createdByAdminId" TEXT,
    "createdByResellerId" TEXT,
    "acquiredVia" "AcquiredVia" NOT NULL DEFAULT 'SIGNUP',
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "standardAmount" INTEGER NOT NULL DEFAULT 30,
    "proAmount" INTEGER NOT NULL DEFAULT 20,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxParallel" INTEGER NOT NULL DEFAULT 1,
    "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "contactSeller" BOOLEAN NOT NULL DEFAULT false,
    "standardCreditsCycle" INTEGER NOT NULL DEFAULT 0,
    "proCreditsCycle" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "features" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "displayPrice" DOUBLE PRECISION,
    "maxParallelOverride" INTEGER,
    "isCustomDeal" BOOLEAN NOT NULL DEFAULT false,
    "periodDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "LedgerType" NOT NULL,
    "jobId" TEXT,
    "adminId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accountEmail" TEXT,
    "cookies" TEXT NOT NULL,
    "sessionToken" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'HEALTHY',
    "creditClassification" "CreditClassification" NOT NULL DEFAULT 'CREDITS_AVAILABLE',
    "googleCreditsBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "googleCreditsReserved" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "maxParallelLimit" INTEGER NOT NULL DEFAULT 5,
    "planTier" TEXT DEFAULT 'Google AI Ultra',
    "projectUrl" TEXT,
    "activeProjectId" TEXT,
    "supportedModels" JSONB,
    "lastHealthCheck" TIMESTAMP(3),
    "cookieExpiresAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProviderBinding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "upstreamFlowProjectId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProviderBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "modelKey" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'IN_QUEUE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "inputAssetIds" JSONB,
    "characterIds" JSONB,
    "outputMediaUrl" TEXT,
    "outputMetadata" JSONB,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "queuePosition" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "upstreamAssetId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "voiceName" TEXT,
    "portraitUrl" TEXT,
    "upstreamCharacterId" TEXT,
    "traits" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentAdminId" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivationMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResellerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerSeatGrant" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "seatsAllocated" INTEGER NOT NULL,
    "seatsUsed" INTEGER NOT NULL DEFAULT 0,
    "wholesalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResellerSeatGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerUserAssignment" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "displayPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "countsForAdmin" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ResellerUserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "NoticeSeverity" NOT NULL DEFAULT 'INFO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'MANUAL_BANK',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "bankReference" TEXT,
    "proofImageUrl" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "category" "LogCategory" NOT NULL DEFAULT 'SYSTEM',
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioLog" (
    "id" TEXT NOT NULL,
    "level" "StudioLogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'studio',
    "details" JSONB,
    "runId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "flowEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhiskState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhiskState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "siteName" TEXT NOT NULL DEFAULT 'Flowbysk',
    "logoUrl" TEXT,
    "contactEmail" TEXT NOT NULL DEFAULT 'support@flowbysk.com',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE INDEX "User_ownedByAdminId_idx" ON "User"("ownedByAdminId");

-- CreateIndex
CREATE INDEX "User_createdByAdminId_idx" ON "User"("createdByAdminId");

-- CreateIndex
CREATE INDEX "User_createdByResellerId_idx" ON "User"("createdByResellerId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeGrant_userId_key" ON "WelcomeGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_walletType_key" ON "Wallet"("userId", "walletType");

-- CreateIndex
CREATE INDEX "CreditLedger_userId_walletType_idx" ON "CreditLedger"("userId", "walletType");

-- CreateIndex
CREATE INDEX "CreditLedger_createdAt_idx" ON "CreditLedger"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderAccount_status_creditClassification_idx" ON "ProviderAccount"("status", "creditClassification");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProviderBinding_projectId_providerAccountId_key" ON "ProjectProviderBinding"("projectId", "providerAccountId");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_status_idx" ON "GenerationJob"("userId", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_status_submittedAt_idx" ON "GenerationJob"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "GenerationJob_expiresAt_idx" ON "GenerationJob"("expiresAt");

-- CreateIndex
CREATE INDEX "Asset_userId_expiresAt_idx" ON "Asset"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Character_userId_expiresAt_idx" ON "Character"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerProfile_userId_key" ON "ResellerProfile"("userId");

-- CreateIndex
CREATE INDEX "ResellerProfile_parentAdminId_idx" ON "ResellerProfile"("parentAdminId");

-- CreateIndex
CREATE INDEX "ResellerSeatGrant_monthKey_idx" ON "ResellerSeatGrant"("monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerSeatGrant_resellerProfileId_planId_monthKey_key" ON "ResellerSeatGrant"("resellerProfileId", "planId", "monthKey");

-- CreateIndex
CREATE INDEX "ResellerUserAssignment_resellerProfileId_removedAt_idx" ON "ResellerUserAssignment"("resellerProfileId", "removedAt");

-- CreateIndex
CREATE INDEX "ResellerUserAssignment_customerId_idx" ON "ResellerUserAssignment"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "Notice_isActive_createdAt_idx" ON "Notice"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_category_level_idx" ON "SystemLog"("category", "level");

-- CreateIndex
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- CreateIndex
CREATE INDEX "StudioLog_createdAt_idx" ON "StudioLog"("createdAt");

-- CreateIndex
CREATE INDEX "StudioLog_level_idx" ON "StudioLog"("level");

-- CreateIndex
CREATE INDEX "StudioLog_source_idx" ON "StudioLog"("source");

-- CreateIndex
CREATE INDEX "StudioLog_runId_idx" ON "StudioLog"("runId");

-- CreateIndex
CREATE INDEX "StudioLog_userId_idx" ON "StudioLog"("userId");

-- CreateIndex
CREATE INDEX "StudioLog_userEmail_idx" ON "StudioLog"("userEmail");

-- CreateIndex
CREATE INDEX "StudioLog_flowEmail_idx" ON "StudioLog"("flowEmail");

-- CreateIndex
CREATE UNIQUE INDEX "WhiskState_projectId_key" ON "WhiskState"("projectId");

-- CreateIndex
CREATE INDEX "WhiskState_userId_idx" ON "WhiskState"("userId");

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_status_idx" ON "ContactMessage"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_updatedAt_idx" ON "SupportTicket"("updatedAt");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_ticketId_idx" ON "SupportTicketMessage"("ticketId");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_createdAt_idx" ON "SupportTicketMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_assignedProviderAccountId_fkey" FOREIGN KEY ("assignedProviderAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ownedByAdminId_fkey" FOREIGN KEY ("ownedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeGrant" ADD CONSTRAINT "WelcomeGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProviderBinding" ADD CONSTRAINT "ProjectProviderBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProviderBinding" ADD CONSTRAINT "ProjectProviderBinding_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerProfile" ADD CONSTRAINT "ResellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerProfile" ADD CONSTRAINT "ResellerProfile_parentAdminId_fkey" FOREIGN KEY ("parentAdminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerSeatGrant" ADD CONSTRAINT "ResellerSeatGrant_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "ResellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerSeatGrant" ADD CONSTRAINT "ResellerSeatGrant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerUserAssignment" ADD CONSTRAINT "ResellerUserAssignment_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "ResellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerUserAssignment" ADD CONSTRAINT "ResellerUserAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerUserAssignment" ADD CONSTRAINT "ResellerUserAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioLog" ADD CONSTRAINT "StudioLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiskState" ADD CONSTRAINT "WhiskState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiskState" ADD CONSTRAINT "WhiskState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

