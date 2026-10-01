import { useRef, useState } from 'react';
import { NAME_MAX, formatScore, sanitizeName } from '../logic/share';
import { saved, toast, type RunResult } from './store';
import { useI18n } from '../../i18n/react';
import { translatePlain, type Lang } from '../../i18n';

interface ShareLink {
  token: string;
  url: string;
  image: string;
  story: string;
  lang: Lang; // the card is rendered in the language it was created in
}

function shareText(r: RunResult, name: string, lang: Lang) {
  return translatePlain(lang, 'share.text', { name: name || translatePlain(lang, 'share.me'), score: formatScore(r.score, lang), felled: r.felled });
}

export function SharePanel({ result }: { result: RunResult }) {
  const [name, setName] = useState(() => saved.name());
  const [created, setLink] = useState<ShareLink | null>(null);
  const { t, lang } = useI18n();
  // Switching language invalidates the link so the card matches the UI.
  const link = created && created.lang === lang ? created : null;
  const [busy, setBusy] = useState(false);
  const pending = useRef<Promise<ShareLink | null> | null>(null);
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  async function ensureLink(): Promise<ShareLink | null> {
    if (link) return link;
    if (pending.current) return pending.current;
    const n = sanitizeName(name);
    saved.setName(n);
    setBusy(true);
    pending.current = fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, s: result.score, f: result.felled, t: result.time, c: result.bestChain, r: result.rare, l: lang }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
        return { ...(await res.json()), lang } as ShareLink;
      })
      .then((l) => {
        setLink(l);
        return l;
      })
      .catch((e) => {
        toast(t('share.failed', { err: e.message }), 'bad');
        return null;
      })
      .finally(() => {
        setBusy(false);
        pending.current = null;
      });
    return pending.current;
  }

  /** Opens a blank tab synchronously (so popup blockers allow it), then navigates. */
  async function openIntent(build: (l: ShareLink) => string) {
    const w = window.open('', '_blank');
    const l = await ensureLink();
    if (!l) {
      w?.close();
      return;
    }
    const url = build(l);
    if (w) w.location.href = url;
    else window.location.href = url;
  }

  const facebook = () => openIntent((l) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(l.url)}`);
  const x = () => openIntent((l) => `https://x.com/intent/post?text=${encodeURIComponent(shareText(result, name, lang))}&url=${encodeURIComponent(l.url)}`);

  async function copy() {
    const l = await ensureLink();
    if (!l) return;
    try {
      await navigator.clipboard.writeText(l.url);
      toast(t('share.copied'), 'good');
    } catch {
      window.prompt(t('share.copyPrompt'), l.url);
    }
  }

  async function nativeShare() {
    const l = await ensureLink();
    if (!l) return;
    try {
      await navigator.share({ title: t('brand.title'), text: shareText(result, name, lang), url: l.url });
    } catch {
      /* user cancelled */
    }
  }

  /**
   * Instagram has no web share URL. On phones we hand the story image to the
   * system share sheet (pick Instagram -> Story); elsewhere we download the
   * image and copy the link so it can be pasted into a link sticker / bio.
   */
  async function instagram() {
    const l = await ensureLink();
    if (!l) return;
    try {
      const blob = await fetch(l.story).then((r) => r.blob());
      const file = new File([blob], `${lang === 'en' ? 'chop-and-run' : 'chat-va-chay'}-${result.score}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: `${shareText(result, name, lang)} ${l.url}` });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await navigator.clipboard?.writeText(l.url).catch(() => {});
      toast(t('share.igDone'), 'good');
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="share">
      <label className="share-name">
        <span>{t('share.nameLabel')}</span>
        <input
          value={name}
          maxLength={NAME_MAX}
          placeholder={t('share.anonymous')}
          onChange={(e) => {
            setName(e.target.value);
            setLink(null);
          }}
        />
      </label>
      <div className="share-buttons">
        <button className="btn share-fb" onClick={facebook} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1v2.4H7.7V14h2.7v8h3.1z" />
          </svg>
          Facebook
        </button>
        <button className="btn share-x" onClick={x} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />
          </svg>
          X
        </button>
        <button className="btn share-ig" onClick={instagram} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM21.9 8.2c-.1-1.6-.4-3-1.6-4.1-1.2-1.2-2.6-1.5-4.2-1.6-1.6-.1-6.6-.1-8.3 0-1.6.1-3 .4-4.1 1.6C2.5 5.2 2.2 6.6 2.1 8.2 2 9.9 2 14.9 2.1 16.5c.1 1.6.4 3 1.6 4.1 1.2 1.2 2.6 1.5 4.1 1.6 1.7.1 6.6.1 8.3 0 1.6-.1 3-.4 4.2-1.6 1.2-1.2 1.5-2.6 1.6-4.1.1-1.7.1-6.6 0-8.3zm-2.2 10.4a3.3 3.3 0 0 1-1.9 1.9c-1.3.5-4.4.4-5.8.4s-4.5.1-5.8-.4a3.3 3.3 0 0 1-1.9-1.9c-.5-1.3-.4-4.4-.4-5.8s-.1-4.5.4-5.8a3.3 3.3 0 0 1 1.9-1.9c1.3-.5 4.4-.4 5.8-.4s4.5-.1 5.8.4a3.3 3.3 0 0 1 1.9 1.9c.5 1.3.4 4.4.4 5.8s.1 4.5-.4 5.8z" />
          </svg>
          Instagram
        </button>
        <button className="btn" onClick={copy} disabled={busy}>
          {t('share.copy')}
        </button>
        {canNativeShare && (
          <button className="btn" onClick={nativeShare} disabled={busy}>
            {t('share.more')}
          </button>
        )}
      </div>
      {link && (
        <a className="share-preview" href={link.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.image} alt={t('share.preview')} />
        </a>
      )}
    </div>
  );
}
