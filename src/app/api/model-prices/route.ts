import { NextResponse } from 'next/server';
import { listEditableModelPrices, MODEL_CATALOG } from '@/lib/credits';

/**
 * Public catalog of effective model credit prices (admin overrides applied).
 * Used by Studio UI so price edits show immediately.
 */
export async function GET() {
  try {
    const models = await listEditableModelPrices();
    const byAlias: Record<string, { modelKey: string; price: number; walletType: string; displayName: string }> =
      {};

    for (const m of models) {
      const row = {
        modelKey: m.modelKey,
        price: m.price,
        walletType: m.walletType,
        displayName: m.displayName,
      };
      byAlias[m.modelKey] = row;
      byAlias[m.modelKey.toUpperCase()] = row;
    }

    // FE / wire aliases Studio sends
    const aliasMap: Record<string, string> = {
      GEM_PIX_2: 'nano_banana_pro',
      NANO_BANANA_PRO: 'nano_banana_pro',
      NARWHAL: 'nano_banana_2',
      NANO_BANANA_2: 'nano_banana_2',
      HARBOR_SEAL: 'nano_banana_lite',
      NANO_BANANA_LITE: 'nano_banana_lite',
      NANO_BANANA_2_LITE: 'nano_banana_lite',
      VEO_3_1_LITE: 'veo_3_1_lite',
      VEO_3_1_FAST: 'veo_3_1_fast',
      VEO_3_1_QUALITY: 'veo_3_1_quality',
      VEO_3_1_LITE_LOW_PRIORITY: 'veo_3_1_lite',
      OMNI_1_1_FLASH: 'omni_flash',
      OMNI_FLASH: 'omni_flash',
    };

    for (const [alias, key] of Object.entries(aliasMap)) {
      const base = models.find((m) => m.modelKey === key);
      if (!base) continue;
      byAlias[alias] = {
        modelKey: base.modelKey,
        price: base.price,
        walletType: base.walletType,
        displayName: base.displayName,
      };
    }

    // Ensure catalog defaults exist even if list filtered something
    for (const item of Object.values(MODEL_CATALOG)) {
      if (!byAlias[item.modelKey]) {
        byAlias[item.modelKey] = {
          modelKey: item.modelKey,
          price: item.price,
          walletType: item.walletType,
          displayName: item.displayName,
        };
      }
    }

    return NextResponse.json({
      success: true,
      models,
      byAlias,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
