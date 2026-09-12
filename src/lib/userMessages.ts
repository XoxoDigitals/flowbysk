/** Messages safe to show customers (no BiB / provider / admin internals). */

export const USER_QUEUE_BUSY =
  'Waiting in queue. Your generation will start shortly.';

export const USER_QUEUE_PLAN_LIMIT =
  'Waiting in queue. Your plan parallel limit is reached.';

export const USER_QUEUE_TOOL =
  'Waiting in queue…';

/**
 * Map internal queue/provider reasons to a customer-safe string.
 * Always log the original server-side for admins.
 */
export function toUserFacingQueueMessage(internal?: string | null): string {
  if (!internal) return USER_QUEUE_BUSY;
  const msg = String(internal);
  if (/parallel generation limit|plan parallel/i.test(msg)) {
    return USER_QUEUE_PLAN_LIMIT;
  }
  if (/In Queue:\s*(Storyteller|Bulk)\b/i.test(msg)) {
    return USER_QUEUE_TOOL;
  }
  if (/In Queue:/i.test(msg) || /provider|BiB|Google account|admin must/i.test(msg)) {
    return USER_QUEUE_BUSY;
  }
  // Hide accidental stack / path leaks
  if (/[/\\].+\.(js|ts|py)|puppeteer|chrome|Executable|stack/i.test(msg)) {
    return USER_QUEUE_BUSY;
  }
  return msg.length > 180 ? USER_QUEUE_BUSY : msg;
}

export function toUserFacingError(internal?: string | null, fallback = 'Something went wrong. Please try again.'): string {
  if (!internal) return fallback;
  const msg = String(internal);
  if (/provider|BiB|aisandbox|puppeteer|chrome|admin must|Google account|cookie|oauth|CDP/i.test(msg)) {
    return fallback;
  }
  if (/[/\\].+\.(js|ts|py)|node_modules/i.test(msg)) {
    return fallback;
  }
  return msg.length > 200 ? fallback : msg;
}
