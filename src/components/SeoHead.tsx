import Head from 'next/head';
import { LANGS, ogLocaleOf, translate, type Lang } from '@/i18n';

export interface SeoProps {
  lang: Lang;
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  /** Emit hreflang links to the ?lang= variants (off for share links: their preview language is fixed). */
  alternates?: boolean;
}

function withLang(url: string, lang: Lang): string {
  const u = new URL(url);
  u.searchParams.set('lang', lang);
  return u.toString();
}

/** Open Graph + Twitter/X card tags (Facebook, Messenger, Zalo, X, LinkedIn… read these). */
export default function SeoHead({ lang, title, description, url, image, imageAlt, alternates = true }: SeoProps) {
  const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {alternates &&
        LANGS.map((l) => <link key={l} rel="alternate" hrefLang={l} href={withLang(url, l)} />)}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={translate(lang, 'brand.title')} />
      <meta property="og:locale" content={ogLocaleOf(lang)} />
      {LANGS.filter((l) => l !== lang).map((l) => (
        <meta key={l} property="og:locale:alternate" content={ogLocaleOf(l)} />
      ))}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:secure_url" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />
      {fbAppId ? <meta property="fb:app_id" content={fbAppId} /> : null}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={imageAlt} />
      <meta name="theme-color" content="#14210f" />
    </Head>
  );
}
