import type { NextApiRequest, NextApiResponse } from 'next';
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatDuration, formatScore, type SharePayload } from '@/game/logic/share';
import { siteOrigin, verifyShareToken } from '@/server/shareToken';
import { pickLang, translate, type DictKey, type Lang, type Vars } from '@/i18n';

/**
 * GET /api/og?t=<token>[&format=story]  or  /api/og?lang=en (generic card)
 * The card is drawn in the share's language (or ?lang without a token).
 * Renders the share card: 1200x630 for Facebook / X link previews,
 * 1080x1920 (format=story) for Instagram Stories.
 */

let fonts: Promise<{ bold: Buffer; medium: Buffer }> | null = null;
function loadFonts() {
  if (!fonts) {
    const dir = path.join(process.cwd(), 'public', 'fonts');
    fonts = Promise.all([
      readFile(path.join(dir, 'BeVietnamPro-ExtraBold.ttf')),
      readFile(path.join(dir, 'BeVietnamPro-Medium.ttf')),
    ]).then(([bold, medium]) => ({ bold, medium }));
  }
  return fonts;
}

const C = {
  bg1: '#0f1d10',
  bg2: '#24391a',
  cream: '#f6ecd2',
  orange: '#f0902a',
  red: '#d6402f',
  moss: '#9fbf6a',
};

function forestSvg(w: number, h: number): string {
  // Layered pine silhouettes, deterministic.
  let s = 0x2545f491;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  const layers = [
    { y: h * 0.62, size: h * 0.22, color: '#2f4a25', step: w / 14 },
    { y: h * 0.78, size: h * 0.28, color: '#1f3519', step: w / 10 },
    { y: h * 0.95, size: h * 0.34, color: '#122412', step: w / 7 },
  ];
  let out = '';
  for (const L of layers) {
    let pts = '';
    for (let x = -L.step; x < w + L.step; x += L.step * (0.6 + rnd() * 0.6)) {
      const th = L.size * (0.7 + rnd() * 0.5);
      const tw = th * 0.38;
      // three stacked triangles per pine
      for (let k = 0; k < 3; k++) {
        const top = L.y - th + k * th * 0.28;
        const bw = tw * (0.55 + k * 0.25);
        pts += `<polygon points="${x},${top} ${x - bw},${top + th * 0.42} ${x + bw},${top + th * 0.42}" />`;
      }
      pts += `<rect x="${x - tw * 0.08}" y="${L.y - th * 0.12}" width="${tw * 0.16}" height="${th * 0.2}" />`;
    }
    out += `<g fill="${L.color}">${pts}</g><rect x="0" y="${L.y}" width="${w}" height="${h}" fill="${L.color}"/>`;
  }
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out}</svg>`).toString('base64')}`;
}

function axeSvg(size: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <g transform="rotate(-35 50 50)">
      <rect x="46" y="18" width="8" height="74" rx="4" fill="#a86a32"/>
      <path d="M54 16 C80 14 88 30 86 46 C74 40 64 40 54 42 Z" fill="#c9d1d8"/>
      <path d="M84 22 C88 30 88 38 86 46" stroke="#f2f6f9" stroke-width="4" fill="none"/>
    </g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'rgba(246,236,210,0.1)', border: '2px solid rgba(246,236,210,0.18)', borderRadius: 20, padding: big ? '22px 30px' : '16px 24px', marginRight: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', fontSize: big ? 30 : 22, color: C.moss, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 2 }}>{label}</div>
      <div style={{ display: 'flex', fontSize: big ? 60 : 44, color: C.cream, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Landscape({ p, host, lang }: { p: SharePayload | null; host: string; lang: Lang }) {
  const tr = (k: DictKey, v?: Vars) => translate(lang, k, v);
  return (
    <div style={{ width: 1200, height: 630, display: 'flex', position: 'relative', background: `linear-gradient(180deg, #7aa3c9 0%, #e7d6ae 48%, ${C.bg2} 70%)`, fontFamily: 'BVP' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={forestSvg(1200, 630)} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0 }} alt="" />
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex', background: 'linear-gradient(90deg, rgba(10,20,10,0.92) 0%, rgba(10,20,10,0.75) 55%, rgba(10,20,10,0.1) 100%)' }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={axeSvg(300)} width={300} height={300} style={{ position: 'absolute', right: 30, top: 150 }} alt="" />
      <div style={{ position: 'absolute', left: 64, top: 52, display: 'flex', flexDirection: 'column', width: 820 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: C.orange, color: '#1a1206', fontSize: 30, fontWeight: 800, padding: '6px 18px', borderRadius: 12 }}>{tr('brand')}</div>
          <div style={{ display: 'flex', marginLeft: 16, color: C.cream, fontSize: 26, opacity: 0.85 }}>{tr('brand.tagline')}</div>
        </div>
        {p ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', marginTop: 26, color: C.cream, fontSize: 40, fontWeight: 500 }}>{tr('og.reached', { name: p.n })}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: -6 }}>
              <div style={{ display: 'flex', fontSize: 150, fontWeight: 800, color: '#ffd23f', lineHeight: 1 }}>{formatScore(p.s, lang)}</div>
              <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, color: C.cream, marginLeft: 18, marginBottom: 20 }}>{tr('og.points')}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 26 }}>
              <Stat label={tr('og.felled')} value={String(p.f)} />
              <Stat label={tr('og.time')} value={formatDuration(p.t, lang)} />
              <Stat label={tr('og.combo')} value={`×${p.c}`} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 40, color: C.cream, fontSize: 64, fontWeight: 800, width: 760 }}>{tr('og.generic')}</div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 64, bottom: 34, display: 'flex', color: C.cream, fontSize: 26 }}>
        <div style={{ display: 'flex', color: C.red, fontWeight: 800, marginRight: 12 }}>{tr('og.cta')}</div>
        <div style={{ display: 'flex', opacity: 0.85 }}>{host}</div>
      </div>
    </div>
  );
}

function Story({ p, host, lang }: { p: SharePayload | null; host: string; lang: Lang }) {
  const tr = (k: DictKey, v?: Vars) => translate(lang, k, v);
  return (
    <div style={{ width: 1080, height: 1920, display: 'flex', position: 'relative', background: `linear-gradient(180deg, #6f9cc6 0%, #ead9b0 40%, ${C.bg2} 62%)`, fontFamily: 'BVP' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={forestSvg(1080, 1920)} width={1080} height={1920} style={{ position: 'absolute', left: 0, top: 0 }} alt="" />
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, display: 'flex', background: 'linear-gradient(180deg, rgba(10,20,10,0.15) 0%, rgba(10,20,10,0.85) 45%, rgba(10,20,10,0.95) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, top: 170, width: 1080, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={axeSvg(300)} width={300} height={300} alt="" />
        <div style={{ display: 'flex', background: C.orange, color: '#1a1206', fontSize: 64, fontWeight: 800, padding: '10px 36px', borderRadius: 20, marginTop: 20 }}>{tr('brand')}</div>
        <div style={{ display: 'flex', color: C.cream, fontSize: 40, marginTop: 18 }}>{tr('brand.tagline')}</div>
        {p ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', color: C.cream, fontSize: 56, marginTop: 120, fontWeight: 500 }}>{p.n}</div>
            <div style={{ display: 'flex', fontSize: 220, fontWeight: 800, color: '#ffd23f', lineHeight: 1, marginTop: 10 }}>{formatScore(p.s, lang)}</div>
            <div style={{ display: 'flex', fontSize: 56, fontWeight: 800, color: C.cream }}>{tr('og.points').toLocaleUpperCase(lang)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 70 }}>
              <div style={{ display: 'flex' }}>
                <Stat big label={tr('og.felled')} value={String(p.f)} />
                <Stat big label={tr('og.combo')} value={`×${p.c}`} />
              </div>
              <Stat big label={tr('og.time')} value={formatDuration(p.t, lang)} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', color: C.cream, fontSize: 80, fontWeight: 800, marginTop: 160, textAlign: 'center', width: 900 }}>{tr('og.generic')}</div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 0, bottom: 150, width: 1080, display: 'flex', flexDirection: 'column', alignItems: 'center', color: C.cream }}>
        <div style={{ display: 'flex', color: C.red, fontSize: 52, fontWeight: 800 }}>{tr('og.cta')}</div>
        <div style={{ display: 'flex', fontSize: 40, marginTop: 14, opacity: 0.9 }}>{host}</div>
      </div>
    </div>
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = typeof req.query.t === 'string' ? req.query.t : null;
  const story = req.query.format === 'story';
  const p = verifyShareToken(token);
  const host = siteOrigin(req).replace(/^https?:\/\//, '');
  const lang = p ? p.l : pickLang(req.query.lang);
  try {
    const f = await loadFonts();
    const img = new ImageResponse(story ? <Story p={p} host={host} lang={lang} /> : <Landscape p={p} host={host} lang={lang} />, {
      width: story ? 1080 : 1200,
      height: story ? 1920 : 630,
      fonts: [
        { name: 'BVP', data: f.bold, weight: 800, style: 'normal' },
        { name: 'BVP', data: f.medium, weight: 500, style: 'normal' },
      ],
    });
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    // Tokens are immutable, so the image can be cached for a long time.
    res.setHeader('Cache-Control', p ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${lang === 'en' ? 'chop-and-run' : 'chat-va-chay'}-${p?.s ?? 'game'}${story ? '-story' : ''}.png"`);
    res.status(200).send(buf);
  } catch (e) {
    console.error('[og] render failed', e);
    res.status(500).send('Failed to render image');
  }
}
