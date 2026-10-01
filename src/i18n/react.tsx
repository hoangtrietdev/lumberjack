import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { DEFAULT_LANG, LANGS, translatePlain, translate, type DictKey, type Lang } from './index.ts';

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const I18nContext = createContext<I18nValue>({ lang: DEFAULT_LANG, setLang: () => {} });

type RichVars = Record<string, ReactNode>;

/** Renders a dictionary string with **bold**, [[kbd]] and {var} (vars may be React nodes). */
export function renderRich(template: string, vars: RichVars = {}): ReactNode {
  const fill = (text: string, keyBase: string): ReactNode[] =>
    text.split(/(\{\w+\})/g).map((part, i) => {
      const m = part.match(/^\{(\w+)\}$/);
      return <Fragment key={`${keyBase}-${i}`}>{m && m[1] in vars ? vars[m[1]] : part}</Fragment>;
    });
  return template.split(/(\*\*.+?\*\*|\[\[.+?\]\])/g).map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**')) return <strong key={i}>{fill(tok.slice(2, -2), `b${i}`)}</strong>;
    if (tok.startsWith('[[') && tok.endsWith(']]')) return <kbd key={i}>{fill(tok.slice(2, -2), `k${i}`)}</kbd>;
    return <Fragment key={i}>{fill(tok, `t${i}`)}</Fragment>;
  });
}

export function useI18n() {
  const { lang, setLang } = useContext(I18nContext);
  return {
    lang,
    setLang,
    /** Plain-text translation (markup stripped). */
    t: (key: DictKey, vars?: Record<string, string | number>) => translatePlain(lang, key, vars),
    /** Rich translation as React nodes. */
    rich: (key: DictKey, vars?: RichVars) => renderRich(translate(lang, key), vars),
  };
}

/** VI | EN toggle. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l} type="button" className={l === lang ? 'on' : ''} aria-pressed={l === lang} onClick={() => setLang(l)} title={translatePlain(l, 'lang.name')}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
