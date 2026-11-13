import type { CrdtOp } from '../types';

export function normalizeWebhookUrl(value: string): string {
  const url = value.trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return url;
  } catch { /* Show the same guidance for malformed and unsupported URLs. */ }
  throw new Error('Enter a full HTTP or HTTPS webhook URL without embedded credentials, or leave it blank to disable.');
}

// Start requests immediately; callers need not wait for delivery to keep editing or sync.
export async function sendWebhook(url: string, operations: CrdtOp[]): Promise<void> {
  const endpoint = normalizeWebhookUrl(url);
  if (!endpoint) return;
  await Promise.all(operations.map(async operation => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
  }));
}
