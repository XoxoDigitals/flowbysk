import { getModelPricing } from './credits';

/**
 * Frontend UI model → Flow wire key for images (approved remap).
 * Prefer catalog wireModel; fall back to explicit map.
 *
 * FE Pro (GEM_PIX_2) → NARWHAL (Nano Banana 2)
 * FE Banana 2 (NARWHAL) → HARBOR_SEAL (Lite)
 * FE Lite (HARBOR_SEAL) → GEM_PIX_2 (Pro)
 */
export function resolveImageWireModel(frontendModel: string): string {
  const pricing = getModelPricing(frontendModel);
  if (pricing?.mediaType === 'IMAGE' && pricing.wireModel) {
    return pricing.wireModel;
  }
  const u = String(frontendModel || '')
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (u === 'GEM_PIX_2' || u === 'NANO_BANANA_PRO' || (u.includes('PRO') && u.includes('BANANA'))) {
    return 'NARWHAL';
  }
  if (
    u === 'HARBOR_SEAL' ||
    u === 'NANO_BANANA_LITE' ||
    u === 'NANO_BANANA_2_LITE' ||
    (u.includes('LITE') && u.includes('BANANA'))
  ) {
    return 'GEM_PIX_2';
  }
  if (u === 'NARWHAL' || u === 'NANO_BANANA_2' || u.includes('BANANA')) {
    return 'HARBOR_SEAL';
  }
  return 'NARWHAL';
}

/**
 * Normalize any video model/key to a Studio FE UI key.
 * Python `resolve_wire_model` then applies T2V/R2V remap to Flow wire.
 */
export function resolveVideoFrontendModel(frontendModel: string): string {
  const u = String(frontendModel || '')
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');

  if (u.includes('OMNI') || u.includes('ABRA')) return 'OMNI_1_1_FLASH';

  // Legacy LP / remapped Lite destination wires → FE Lite
  if (u.includes('LOW_PRIORITY') || u.includes('LOWER_PRIORITY') || u.includes('LITE_LOW')) {
    return 'VEO_3_1_LITE';
  }

  // Quality UI or old quality wire / post-remap Fast wires → FE Quality
  if (u.includes('QUALITY') || u === 'VEO_3_1_T2V' || u.includes('I2V_S_FAST') || u.includes('T2V_FAST')) {
    return 'VEO_3_1_QUALITY';
  }

  // Post-remap Lite wires (t2v_lite / r2v_lite) → FE Fast
  if (u.includes('T2V_LITE') || u.includes('R2V_LITE')) {
    return 'VEO_3_1_FAST';
  }

  // UI / catalog keys
  if (u.includes('FAST') || u.includes('ULTRA')) return 'VEO_3_1_FAST';
  if (u.includes('LITE') || u.includes('VEO')) return 'VEO_3_1_LITE';

  return 'VEO_3_1_LITE';
}

/**
 * Studio FE video key → Flow wire key (approved remap).
 * Lite → lite_low_priority, Fast → lite, Quality → fast, Omni unchanged.
 */
export function resolveVideoWireModel(
  frontendModel: string,
  opts?: { mode?: 't2v' | 'i2v' | 'r2v'; duration?: number; aspectRatio?: string }
): string {
  const mode = (opts?.mode || 't2v').toLowerCase();
  const duration = opts?.duration ?? 8;
  const aspect = opts?.aspectRatio || '16:9';
  const fe = resolveVideoFrontendModel(frontendModel);

  if (fe === 'OMNI_1_1_FLASH') {
    const secs = duration <= 4 ? 4 : duration <= 6 ? 6 : duration <= 8 ? 8 : 10;
    return `abra_t2v_${secs}s`;
  }

  const isI2v = mode === 'i2v' || mode === 'r2v';
  if (!isI2v) {
    if (fe === 'VEO_3_1_LITE') return 'veo_3_1_t2v_lite_low_priority';
    if (fe === 'VEO_3_1_FAST') return 'veo_3_1_t2v_lite';
    if (fe === 'VEO_3_1_QUALITY') return 'veo_3_1_t2v_fast';
    return 'veo_3_1_t2v_lite_low_priority';
  }

  if (fe === 'VEO_3_1_LITE') return 'veo_3_1_r2v_lite_low_priority';
  if (fe === 'VEO_3_1_FAST') return 'veo_3_1_r2v_lite';
  if (fe === 'VEO_3_1_QUALITY') {
    return aspect === '9:16' ? 'veo_3_1_i2v_s_fast_portrait' : 'veo_3_1_i2v_s_fast';
  }
  return 'veo_3_1_r2v_lite_low_priority';
}

/** Keep FE key for Python worker (it remaps once). */
export function resolveImageFrontendModel(frontendModel: string): string {
  const u = String(frontendModel || '')
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (u === 'NANO_BANANA_PRO' || u === 'GEM_PIX_2' || (u.includes('PRO') && u.includes('BANANA'))) {
    return 'GEM_PIX_2';
  }
  if (
    u === 'NANO_BANANA_LITE' ||
    u === 'NANO_BANANA_2_LITE' ||
    u === 'HARBOR_SEAL' ||
    (u.includes('LITE') && u.includes('BANANA'))
  ) {
    return 'HARBOR_SEAL';
  }
  if (u === 'NANO_BANANA_2' || u === 'NARWHAL' || u.includes('BANANA')) {
    return 'NARWHAL';
  }
  return u || 'GEM_PIX_2';
}
