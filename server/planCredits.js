/**
 * Hardcoded STD credits for marketing + plan-select fill.
 * Do not read these display amounts from the database.
 */
const HARDCODED_STD_CREDITS = Object.freeze({
  Free: 50,
  Starter: 5000,
  Pro: 25000,
  Business: 45000,
});

function hardcodedStdForPlanName(name) {
  const key = String(name || '').trim();
  if (Object.prototype.hasOwnProperty.call(HARDCODED_STD_CREDITS, key)) {
    return HARDCODED_STD_CREDITS[key];
  }
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(HARDCODED_STD_CREDITS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

module.exports = { HARDCODED_STD_CREDITS, hardcodedStdForPlanName };
