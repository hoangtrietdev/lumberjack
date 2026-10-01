// Tiny i18n layer: Vietnamese (default) and English. Framework-free so the
// engine, API routes and tests can use it; React helpers live in react.tsx.
import { vi } from './vi.ts';
import { en } from './en.ts';

export type Lang = 'vi' | 'en';
export const LANGS: Lang[] = ['vi', 'en'];
export const DEFAULT_LANG: Lang = 'vi';
export type DictKey = keyof typeof vi;
export type Dict = { [K in DictKey]: string };
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Dict> = { vi, en };
export const LANG_COOKIE = 'lang';

export function isLang(x: unknown): x is Lang {
  return x === 'vi' || x === 'en';
}

/** Maps any language tag ("en-US", "vi") to a supported language, or null. */
export function normalizeLang(x: unknown): Lang | null {
  if (typeof x !== 'string') return null;
  const base = x.trim().toLowerCase().slice(0, 2);
  return isLang(base) ? base : null;
}

/** Picks the best supported language from an Accept-Language header. */
export function fromAcceptLanguage(header: string | undefined | null): Lang | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag, q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const l = normalizeLang(tag);
    if (l) return l;
  }
  return null;
}

/** First supported language among the candidates, else the default. */
export function pickLang(...candidates: unknown[]): Lang {
  for (const c of candidates) {
    const l = normalizeLang(c);
    if (l) return l;
  }
  return DEFAULT_LANG;
}

export function translate(lang: Lang, key: DictKey, vars?: Vars): string {
  const s = DICTS[lang][key] ?? DICTS[DEFAULT_LANG][key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Same as translate() but strips the **bold** / [[key]] markup (for plain text). */
export function translatePlain(lang: Lang, key: DictKey, vars?: Vars): string {
  return translate(lang, key, vars).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[\[(.+?)\]\]/g, '$1');
}

export function dictFor(lang: Lang): Dict {
  return DICTS[lang];
}

// ------------------------------------------------- current (client) language --

let current: Lang = DEFAULT_LANG;

export function getLang(): Lang {
  return current;
}

/** Sets the active language (engine strings, number formats, <html lang>, cookie). */
export function applyLang(lang: Lang) {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  }
}

/** Shorthand for the engine: translate with the active language. */
export function t(key: DictKey, vars?: Vars): string {
  return translatePlain(current, key, vars);
}

/** Client-side detection: ?lang= → cookie → browser language → default. */
export function detectClientLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const q = new URLSearchParams(window.location.search).get('lang');
  const cookie = document.cookie.match(/(?:^|;\s*)lang=([a-z]{2})/)?.[1];
  return pickLang(q, cookie, ...(navigator.languages ?? [navigator.language]));
}

/** Server-side detection for getServerSideProps. */
export function detectServerLang(query: Record<string, unknown>, cookies: Record<string, string | undefined>, acceptLanguage?: string): Lang {
  return pickLang(query.lang, cookies[LANG_COOKIE], fromAcceptLanguage(acceptLanguage));
}

export function localeOf(lang: Lang): string {
  return lang === 'vi' ? 'vi-VN' : 'en-US';
}

export function ogLocaleOf(lang: Lang): string {
  return lang === 'vi' ? 'vi_VN' : 'en_US';
}
