/** Exact Studio model labels — frontend names only (never expose Low Priority). */

const MODEL_DISPLAY: Record<string, string> = {
  VEO_3_1_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
  VEO_3_1_LITE: 'Veo 3.1 - Lite',
  VEO_3_1_FAST: 'Veo 3.1 - Fast',
  VEO_3_1_QUALITY: 'Veo 3.1 - Quality',
  VEO_3_1_R2V_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
  VEO_3_1_R2V_LITE: 'Veo 3.1 - Fast',
  VEO_3_1_EXTEND_LITE: 'Veo 3.1 - Fast',
  VEO_3_1_EXTEND_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
  VEO_3_1_T2V_LITE_LOW_PRIORITY: 'Veo 3.1 - Lite',
  VEO_3_1_T2V_LITE: 'Veo 3.1 - Fast',
  VEO_3_1_T2V_FAST: 'Veo 3.1 - Quality',
  VEO_3_1_T2V_FAST_ULTRA: 'Veo 3.1 - Quality',
  VEO_3_1_T2V: 'Veo 3.1 - Quality',
  VEO_3_1_I2V_S_FAST: 'Veo 3.1 - Quality',
  VEO_3_1_I2V_S_FAST_PORTRAIT: 'Veo 3.1 - Quality',
  VEO_3_1_I2V_S_FAST_ULTRA: 'Veo 3.1 - Quality',
  OMNI_1_1_FLASH: 'Omni 1.1 Flash',
  // Frontend image keys (charge these; wire remapped in worker)
  NARWHAL: 'Nano Banana 2',
  HARBOR_SEAL: 'Nano Banana 2 Lite',
  GEM_PIX_2: 'Nano Banana 2 Pro',
  NANO_BANANA_2: 'Nano Banana 2',
  NANO_BANANA_LITE: 'Nano Banana 2 Lite',
  NANO_BANANA_PRO: 'Nano Banana 2 Pro',
  veo_3_1_lite_low_priority: 'Veo 3.1 - Lite',
  veo_3_1_lite: 'Veo 3.1 - Lite',
  veo_3_1_fast: 'Veo 3.1 - Fast',
  veo_3_1_quality: 'Veo 3.1 - Quality',
  omni_flash: 'Omni 1.1 Flash',
  nano_banana_2: 'Nano Banana 2',
  nano_banana_lite: 'Nano Banana 2 Lite',
  nano_banana_pro: 'Nano Banana 2 Pro',
};

export function formatModelDisplayName(
  model?: string | null,
  mediaType: 'video' | 'image' = 'video'
): string {
  if (!model) {
    return mediaType === 'image' ? 'Nano Banana 2 Pro' : 'Veo 3.1 - Lite';
  }
  const raw = String(model).trim();
  const paren = raw.match(/\(([^)]+)\)/);
  const token = (paren ? paren[1] : raw).trim();
  const u = token
    .toUpperCase()
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');

  if (MODEL_DISPLAY[token]) return MODEL_DISPLAY[token];
  if (MODEL_DISPLAY[u]) return MODEL_DISPLAY[u];

  const blob = `${raw} ${u}`;
  // Wire-only leftovers: map remapped wires back to frontend labels when UI key missing
  if (/LITE_LOW_PRIORITY|T2V_LITE_LOW|R2V_LITE_LOW|LOWER[_\s-]?PRIORITY/i.test(blob)) {
    return 'Veo 3.1 - Lite';
  }
  if (/LITE/i.test(blob) && /VEO|T2V|R2V|EXTEND|I2V/i.test(blob) && !/FAST/i.test(blob)) {
    return 'Veo 3.1 - Fast';
  }
  if (/FAST|I2V_S_FAST|R2V_FAST|T2V_FAST/i.test(blob) && /VEO|I2V|R2V|T2V/i.test(blob)) {
    return 'Veo 3.1 - Quality';
  }
  if (/QUALITY/i.test(blob) || (/\bVEO_3_1_T2V\b/i.test(u) && !/FAST|LITE/i.test(u))) {
    return 'Veo 3.1 - Quality';
  }
  if (/OMNI|ABRA_T2V/i.test(blob)) return 'Omni 1.1 Flash';
  if (/GEM_PIX/i.test(blob)) return 'Nano Banana 2 Pro';
  if (/NARWHAL/i.test(blob)) return 'Nano Banana 2';
  if (/HARBOR_SEAL/i.test(blob)) return 'Nano Banana 2 Lite';

  if (/^Veo 3\.1\s*-/i.test(raw) || /^Omni /i.test(raw) || /^Nano Banana/i.test(raw)) {
    return raw
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s*\[Lower Priority\]/i, '')
      .trim();
  }
  if (/^Veo 3\.1(\s|$)/i.test(raw)) return 'Veo 3.1 - Lite';
  if (/^Imagen/i.test(raw)) return 'Nano Banana 2 Pro';

  return raw;
}
