import QRCode from 'qrcode';
import { publicBaseUrl } from './supabase';
import type { RestaurantTable } from './types';

/**
 * The URL printed on a table's QR code and written to its NFC tag.
 *
 * The qr_token is part of the URL because resolve_table() requires it: a
 * guessed /r/slug/t/7 opens nothing. Rotating the token in the admin screen
 * invalidates the printed code, which is the recovery path when a code is
 * photographed and shared online.
 */
export function tableUrl(slug: string, table: Pick<RestaurantTable, 'code' | 'qr_token'>): string {
  return `${publicBaseUrl}/r/${slug}/t/${encodeURIComponent(table.code)}?k=${table.qr_token}`;
}

export interface QrOptions {
  /** pixel width of the generated PNG */
  size?: number;
  /** quiet zone in modules; 2 is the practical minimum for reliable scans */
  margin?: number;
  dark?: string;
  light?: string;
}

/**
 * Error correction level M survives roughly 15% damage, which is the right
 * trade-off for a sticker on a restaurant table — H wastes density, L fails
 * once the sticker picks up a scratch or a thumbprint.
 */
export async function qrDataUrl(text: string, opts: QrOptions = {}): Promise<string> {
  const { size = 1024, margin = 2, dark = '#0f0f0d', light = '#ffffff' } = opts;
  return QRCode.toDataURL(text, {
    width: size,
    margin,
    errorCorrectionLevel: 'M',
    color: { dark, light },
  });
}

export async function qrSvg(text: string, opts: QrOptions = {}): Promise<string> {
  const { margin = 2, dark = '#0f0f0d', light = '#ffffff' } = opts;
  return QRCode.toString(text, {
    type: 'svg',
    margin,
    errorCorrectionLevel: 'M',
    color: { dark, light },
  });
}

/* ------------------------------------------------------------------- NFC - */

export interface NfcSupport {
  supported: boolean;
  reason?: 'no-api' | 'insecure-context';
}

/**
 * Web NFC exists only in Chromium on Android, and only over HTTPS. Everywhere
 * else the admin screen falls back to showing the URL for a third-party writer
 * app, which is how most venues will tag their tables anyway.
 */
export function nfcSupport(): NfcSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'no-api' };
  if (!('NDEFReader' in window)) return { supported: false, reason: 'no-api' };
  if (!window.isSecureContext) return { supported: false, reason: 'insecure-context' };
  return { supported: true };
}

interface NdefWriter {
  write: (message: { records: { recordType: string; data: string }[] }) => Promise<void>;
}

/**
 * Writes the table URL to a tag held against the phone. The caller shows the
 * "hold the tag against your phone" prompt; this resolves once the write
 * lands, or rejects with a message worth showing.
 */
export async function writeNfcTag(url: string): Promise<void> {
  const support = nfcSupport();
  if (!support.supported) {
    throw new Error(support.reason === 'insecure-context' ? 'insecure-context' : 'no-api');
  }

  const Ctor = (window as unknown as { NDEFReader: new () => NdefWriter }).NDEFReader;
  const writer = new Ctor();

  await writer.write({ records: [{ recordType: 'url', data: url }] });
}

/* -------------------------------------------------------- printable sheet */

/**
 * Builds a self-contained HTML page of QR cards, opened in a new window for
 * printing. Generated as a document rather than styling the admin screen for
 * print, so the layout is predictable across browsers and the staff member
 * can print on a shared printer without the dashboard chrome.
 */
export async function buildQrSheet(
  restaurantName: string,
  slug: string,
  tables: RestaurantTable[],
  labels: { table: string; scanPrompt: string },
): Promise<string> {
  const cards = await Promise.all(
    tables.map(async (tb) => {
      const url = tableUrl(slug, tb);
      const svg = await qrSvg(url, { margin: 1 });
      return `
        <div class="card">
          <div class="brand">${escapeHtml(restaurantName)}</div>
          <div class="qr">${svg}</div>
          <div class="label">${escapeHtml(tb.label)}</div>
          <div class="prompt">${escapeHtml(labels.scanPrompt)}</div>
          <div class="code">${escapeHtml(tb.code)}</div>
        </div>`;
    }),
  );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(restaurantName)} — QR</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f0f0d;
  }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card {
    border: 1px solid #d1d1cb;
    border-radius: 6mm;
    padding: 8mm 6mm;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .brand { font-size: 11pt; font-weight: 600; letter-spacing: .2px; }
  .qr { margin: 5mm auto 4mm; width: 52mm; height: 52mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .label { font-size: 15pt; font-weight: 700; }
  .prompt { margin-top: 2mm; font-size: 9pt; color: #57574e; }
  .code { margin-top: 3mm; font-size: 7.5pt; color: #b0b0a6; font-variant-numeric: tabular-nums; }
  @media screen {
    body { background: #f6f6f5; padding: 10mm; }
    .sheet { max-width: 210mm; margin: 0 auto; }
  }
</style>
</head>
<body>
  <div class="sheet">${cards.join('')}</div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 350));</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
