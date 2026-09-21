import { prisma } from './prisma';
import fs from 'fs';
import { JobStatus } from '@prisma/client';

/** Failed gallery cards auto-delete after this window. */
export const FAILED_CARD_TTL_MS = 4 * 60 * 60 * 1000;

export function failedCardCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - FAILED_CARD_TTL_MS);
}

/** True when a FAILED job should no longer appear in All Media. */
export function isFailedCardStale(
  completedAt: Date | string | null | undefined,
  updatedAt?: Date | string | null,
  createdAt?: Date | string | null,
  now: Date = new Date()
): boolean {
  const raw = completedAt || updatedAt || createdAt;
  if (!raw) return false;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t >= FAILED_CARD_TTL_MS;
}

export async function runRetentionCleanupSweep() {
  const now = new Date();
  const cutoff = failedCardCutoff(now);

  const expiredJobs = await prisma.generationJob.findMany({
    where: {
      expiresAt: { lt: now },
      status: { notIn: [JobStatus.EXPIRED, JobStatus.FAILED, JobStatus.CANCELLED] },
    },
    take: 100,
  });

  for (const job of expiredJobs) {
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.EXPIRED,
        outputMediaUrl: null,
        outputMetadata: { note: 'Output expired under 24-hour retention policy' },
      },
    });
  }

  // Auto-delete Failed cards after 4 hours
  const staleFailed = await prisma.generationJob.findMany({
    where: {
      status: JobStatus.FAILED,
      OR: [
        { completedAt: { lt: cutoff } },
        { completedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    take: 100,
    select: { id: true },
  });
  let deletedFailedJobsCount = 0;
  if (staleFailed.length > 0) {
    const ids = staleFailed.map((j) => j.id);
    const deleted = await prisma.generationJob.deleteMany({
      where: { id: { in: ids } },
    });
    deletedFailedJobsCount = deleted.count;
  }

  const expiredAssets = await prisma.asset.findMany({
    where: { expiresAt: { lt: now } },
    take: 100,
  });

  for (const asset of expiredAssets) {
    if (asset.storagePath && fs.existsSync(asset.storagePath)) {
      try {
        fs.unlinkSync(asset.storagePath);
      } catch (err) {
        console.error(`Failed to delete expired asset file ${asset.storagePath}:`, err);
      }
    }
    await prisma.asset.delete({ where: { id: asset.id } });
  }

  const expiredCharacters = await prisma.character.findMany({
    // Durable characters use far-future expiresAt (~10y) so they never land here
    where: { expiresAt: { lt: now } },
    take: 100,
  });

  for (const character of expiredCharacters) {
    try {
      const { deleteCharacterPortraitFiles } = await import('@/lib/characterPortrait');
      deleteCharacterPortraitFiles(character.userId, character.id, character.traits);
    } catch {
      /* ignore */
    }
    await prisma.character.delete({ where: { id: character.id } });
  }

  return {
    expiredJobsCount: expiredJobs.length,
    deletedFailedJobsCount,
    expiredAssetsCount: expiredAssets.length,
    expiredCharactersCount: expiredCharacters.length,
  };
}
