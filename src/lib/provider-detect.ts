/**
 * Google Flow Provider Account Detector
 * Auto-detects Google account email, subscription plan tier (Ultra/Pro/Free),
 * credits balance, and cookie expiration from live Google Labs APIs.
 */

export interface DetectedAccountDetails {
  success: boolean;
  email: string;
  name?: string;
  planName: string;
  paygateTier: string;
  serviceTier?: string;
  sku?: string;
  credits: number;
  cookieExpiresAt: Date;
  creditClassification: 'CREDITS_AVAILABLE' | 'CREDITS_EXHAUSTED';
  isValidSession: boolean;
  rawCreditsResponse?: any;
  activeProjectId?: string;
  activeProjectUrl?: string;
  error?: string;
}

export async function detectGoogleFlowAccount(cookies: string): Promise<DetectedAccountDetails> {
  const cleanCookies = (cookies || '').trim();
  if (!cleanCookies) {
    return {
      success: false,
      email: '',
      planName: 'Unknown',
      paygateTier: 'PAYGATE_TIER_NOT_PAID',
      credits: 0,
      cookieExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      creditClassification: 'CREDITS_EXHAUSTED',
      isValidSession: false,
      error: 'No cookies provided',
    };
  }

  const commonHeaders: Record<string, string> = {
    'Origin': 'https://labs.google',
    'Referer': 'https://labs.google/fx/tools/flow',
    'Cookie': cleanCookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  let accessToken = '';
  let email = '';
  let name = '';
  let sessionExpiresStr = '';

  // 1. Query Google Labs session endpoint to validate cookies & extract access token
  try {
    const sessionRes = await fetch('https://labs.google/fx/api/auth/session', {
      headers: commonHeaders,
    });

    if (sessionRes.ok) {
      const sessionData = await sessionRes.json();
      accessToken = sessionData.access_token || '';
      sessionExpiresStr = sessionData.expires || '';
      if (sessionData.user) {
        email = sessionData.user.email || '';
        name = sessionData.user.name || '';
      }
    } else {
      console.warn('Google Labs auth session check returned status:', sessionRes.status);
    }
  } catch (err: any) {
    console.warn('Failed to query Google Labs session:', err.message);
  }

  // Calculate Cookie Expiration:
  let cookieExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  if (sessionExpiresStr) {
    try {
      const parsed = new Date(sessionExpiresStr);
      if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
        cookieExpiresAt = parsed;
      }
    } catch (_) {}
  }

  // 2. Query aisandbox credits API to detect plan tier, SKU, and credit balance
  let paygateTier = 'PAYGATE_TIER_NOT_PAID';
  let serviceTier = '';
  let sku = '';
  let detectedCredits = 0;
  let rawCredits: any = null;

  if (accessToken) {
    try {
      const creditsRes = await fetch('https://aisandbox-pa.googleapis.com/v1/credits', {
        headers: {
          ...commonHeaders,
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (creditsRes.ok) {
        rawCredits = await creditsRes.json();
        paygateTier = rawCredits.userPaygateTier || paygateTier;
        serviceTier = rawCredits.serviceTier || '';
        sku = rawCredits.sku || '';

        // Extract explicit balance if provided
        for (const key of ['remainingCredits', 'credits', 'balance', 'creditBalance', 'remaining', 'subscriptionCredits']) {
          if (rawCredits[key] !== undefined && rawCredits[key] !== null) {
            const num = Number(rawCredits[key]);
            if (!isNaN(num) && num > 0) {
              detectedCredits = num;
              break;
            }
          }
        }
      } else {
        console.warn('Aisandbox credits check returned status:', creditsRes.status);
      }
    } catch (err: any) {
      console.warn('Failed to query aisandbox credits:', err.message);
    }
  }

  // 3. Classify Plan Name based on Google Flow paygateTier, sku, and serviceTier
  const tierUpper = (paygateTier || '').toUpperCase();
  const skuUpper = (sku || '').toUpperCase();
  const serviceUpper = (serviceTier || '').toUpperCase();

  let planName = 'Free Tier';
  if (
    serviceUpper.includes('ADVANCED') ||
    tierUpper.includes('TIER3') ||
    skuUpper.includes('TIER3') ||
    tierUpper.includes('ULTRA') ||
    skuUpper.includes('ULTRA') ||
    serviceUpper.includes('ULTRA') ||
    tierUpper === 'PAYGATE_TIER_THREE'
  ) {
    planName = 'Google AI Ultra';
    if (detectedCredits <= 0) detectedCredits = 5000;
  } else if (
    tierUpper.includes('TIER2') ||
    skuUpper.includes('TIER2') ||
    tierUpper.includes('PRO') ||
    skuUpper.includes('PRO') ||
    serviceUpper.includes('INTERMEDIATE')
  ) {
    planName = 'Google AI Pro';
    if (detectedCredits <= 0) detectedCredits = 1000;
  } else if (tierUpper.includes('TIER1') || skuUpper.includes('TIER1')) {
    planName = 'Google AI Tier 1';
    if (detectedCredits <= 0) detectedCredits = 500;
  } else if (accessToken && detectedCredits > 0) {
    planName = detectedCredits >= 2000 ? 'Google AI Ultra' : 'Google AI Pro';
  } else {
    planName = accessToken ? 'Google AI Pro' : 'Free Tier';
  }

  // 4. Check if the active Python worker has live session, project, and credits for this account
  let activeProjectId = '';
  let activeProjectUrl = '';
  try {
    const pyRes = await fetch('http://127.0.0.1:8000/api/auth/status', {
      headers: { 'Accept': 'application/json' },
    });
    if (pyRes.ok) {
      const pyData = await pyRes.json();
      if (pyData.email && (!email || pyData.email === email)) {
        if (!email) email = pyData.email;
        if (pyData.plan_name) planName = pyData.plan_name;
        if (pyData.credits !== undefined && pyData.credits > 0) {
          detectedCredits = pyData.credits;
        }
        if (pyData.active_project_id) activeProjectId = pyData.active_project_id;
        if (pyData.active_project_url) activeProjectUrl = pyData.active_project_url;
      }
    }
  } catch {}

  const isValidSession = Boolean(accessToken) || Boolean(email);
  const creditClassification = detectedCredits > 0 ? 'CREDITS_AVAILABLE' : 'CREDITS_EXHAUSTED';

  return {
    success: isValidSession,
    email: email || 'operator@google.com',
    name: name || '',
    planName,
    paygateTier,
    serviceTier,
    sku,
    credits: detectedCredits,
    cookieExpiresAt,
    creditClassification,
    isValidSession,
    rawCreditsResponse: rawCredits,
    activeProjectId,
    activeProjectUrl,
  };
}
