import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlausible, normalizePayload } from '@/game/logic/share';
import { createShareToken, siteOrigin } from '@/server/shareToken';
import { pickLang, translate } from '@/i18n';

/**
 * POST /api/share  { n, s, f, t, c, r, l }  ->  { token, url, image, story }
 * `l` (vi | en) is the language of the card and the link preview.
 * Signs a high-score payload so it can be shared as a link with Open Graph tags.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  const lang = pickLang(body?.l, req.headers['accept-language']?.slice(0, 2));
  const p = normalizePayload({ ...(body ?? {}), d: Math.floor(Date.now() / 1000) });
  if (!p) return res.status(400).json({ error: translate(lang, 'api.invalid') });
  if (!isPlausible(p)) return res.status(422).json({ error: translate(lang, 'api.implausible') });
  const token = createShareToken(p);
  const origin = siteOrigin(req);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    token,
    url: `${origin}/s/${token}`,
    image: `${origin}/api/og?t=${encodeURIComponent(token)}`,
    story: `${origin}/api/og?t=${encodeURIComponent(token)}&format=story`,
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
