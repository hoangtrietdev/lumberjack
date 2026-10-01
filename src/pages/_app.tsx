import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { applyLang, detectClientLang, isLang, type Lang } from "@/i18n";
import { I18nContext } from "@/i18n/react";

export default function App({ Component, pageProps }: AppProps) {
  // Pages rendered on the server pass the detected language in `pageProps.lang`;
  // client-only pages fall back to ?lang / cookie / browser language.
  const [lang, setLang] = useState<Lang>(() => {
    const l: Lang = isLang(pageProps.lang) ? pageProps.lang : typeof window !== "undefined" ? detectClientLang() : "vi";
    if (typeof window !== "undefined") applyLang(l);
    return l;
  });

  useEffect(() => {
    applyLang(lang);
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang]);

  return (
    <I18nContext.Provider value={value}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      </Head>
      <Component {...pageProps} />
    </I18nContext.Provider>
  );
}
