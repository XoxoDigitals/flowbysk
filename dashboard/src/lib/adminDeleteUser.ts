import { prisma } from './prisma';
import { UserRole } from '@prisma/client';

export type DeleteUserActor = {
  userId: string;
  role: string;
};

export type DeleteUserResult =
  | { ok: true; id: string; email: string }
  | { ok: false; id: string; error: string };

/**
 * Permanently delete a user and related rows. Enforces role rules for the actor.
 */
export async function deleteUserForAdmin(
  actor: DeleteUserActor,
  userId: string
): Promise<DeleteUserResult> {
  if (!userId) {
    return { ok: false, id: userId, error: 'userId required' };
  }
  if (userId === actor.userId) {
    return { ok: false, id: userId, error: 'You cannot delete your own account' };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      resellerProfile: { select: { id: true } },
    },
  });

  if (!target) {
    return { ok: false, id: userId, error: 'User not found' };
  }

  if (target.role === UserRole.SUPER_ADMIN) {
    return { ok: false, id: userId, error: 'Cannot delete super admin accounts' };
  }

  if (target.role === UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
    return { ok: false, id: userId, error: 'Only super admin can delete admin accounts' };
  }

  const id = target.id;

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { ownedByAdminId: id },
      data: { ownedByAdminId: null },
    });
    await tx.user.updateMany({
      where: { createdByAdminId: id },
      data: { createdByAdminId: null },
    });
    await tx.user.updateMany({
      where: { createdByResellerId: id },
      data: { createdByResellerId: null },
    });
    await tx.user.update({
      where: { id },
      data: { assignedProviderAccountId: null, providerAssignmentManual: false },
    });

    if (target.resellerProfile?.id) {
      const rid = target.resellerProfile.id;
      await tx.resellerUserAssignment.deleteMany({ where: { resellerProfileId: rid } });
      await tx.resellerSeatGrant.deleteMany({ where: { resellerProfileId: rid } });
      await tx.resellerProfile.delete({ where: { id: rid } });
    }

    await tx.studioLog.deleteMany({ where: { userId: id } });
    await tx.creditLedger.deleteMany({ where: { userId: id } });
    await tx.wallet.deleteMany({ where: { userId: id } });
    await tx.welcomeGrant.deleteMany({ where: { userId: id } });
    await tx.subscription.deleteMany({ where: { userId: id } });
    await tx.order.deleteMany({ where: { userId: id } });
    await tx.generationJob.deleteMany({ where: { userId: id } });
    await tx.asset.deleteMany({ where: { userId: id } });
    await tx.character.deleteMany({ where: { userId: id } });
    await tx.whiskState.deleteMany({ where: { userId: id } });
    await tx.supportTicket.deleteMany({ where: { userId: id } });
    await tx.resellerUserAssignment.deleteMany({ where: { customerId: id } });
    await tx.project.deleteMany({ where: { userId: id } });

    await tx.adminAuditLog.create({
      data: {
        adminId: actor.userId,
        action: 'ADMIN_USER_DELETED',
        targetType: 'USER',
        targetId: id,
        details: { email: target.email, role: target.role },
      },
    });

    await tx.user.delete({ where: { id } });
  });

  return { ok: true, id, email: target.email };
}

/** Delete many users sequentially; skips failures and reports per-id results. */
export async function deleteUsersForAdmin(
  actor: DeleteUserActor,
  userIds: string[]
): Promise<{ deleted: number; failed: { id: string; error: string }[]; results: DeleteUserResult[] }> {
  const unique = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const results: DeleteUserResult[] = [];
  for (const id of unique) {
    try {
      results.push(await deleteUserForAdmin(actor, id));
    } catch (e: any) {
      results.push({ ok: false, id, error: e?.message || 'Delete failed' });
    }
  }
  return {
    deleted: results.filter((r) => r.ok).length,
    failed: results
      .filter((r): r is { ok: false; id: string; error: string } => !r.ok)
      .map((r) => ({ id: r.id, error: r.error })),
    results,
  };
}
