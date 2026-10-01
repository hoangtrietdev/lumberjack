// Server-only helpers for signed share tokens: `<payload>.<signature>`.
// The signature stops people from editing the score in the URL by hand.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { decodePayload, encodePayload, isPlausible, type SharePayload } from '../game/logic/share.ts';

const DEV_SECRET = 'chat-va-chay-dev-secret-change-me';

function secret(): string {
  const s = process.env.SHARE_SECRET;
  if (!s && process.env.NODE_ENV === 'production') {
    console.warn('[share] SHARE_SECRET is not set; using the development secret.');
  }
  return s || DEV_SECRET;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url').slice(0, 22);
}

export function createShareToken(p: SharePayload): string {
  const data = encodePayload(p);
  return `${data}.${sign(data)}`;
}

export function verifyShareToken(token: string | undefined | null): SharePayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const p = decodePayload(data);
  if (!p || !isPlausible(p)) return null;
  return p;
}

/** Absolute origin for OG tags. Prefers NEXT_PUBLIC_SITE_URL, else the request host. */
export function siteOrigin(req?: IncomingMessage): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, '');
  const h = req?.headers ?? {};
  const host = (h['x-forwarded-host'] as string) || (h.host as string) || 'localhost:3000';
  const proto = ((h['x-forwarded-proto'] as string) || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host.split(',')[0]}`;
}
