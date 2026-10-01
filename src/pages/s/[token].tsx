import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import SeoHead from '@/components/SeoHead';
import { formatDuration, formatScore, shareDescription, shareTitle, type SharePayload } from '@/game/logic/share';
import { LANG_COOKIE, pickLang, translate, type Lang } from '@/i18n';
import { LangSwitch, useI18n } from '@/i18n/react';
import { siteOrigin, verifyShareToken } from '@/server/shareToken';

interface Props {
  p: SharePayload;
  token: string;
  origin: string;
  lang: Lang;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params, req, res, query }) => {
  const token = typeof params?.token === 'string' ? params.token : '';
  const p = verifyShareToken(token);
  if (!p) return { notFound: true };
  // Crawlers (Facebook, X…) and browsers can cache this page: the token never changes.
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  // Page UI: ?lang → visitor's saved choice → the language the score was shared in.
  const lang = pickLang(query.lang, req.cookies[LANG_COOKIE], p.l);
  return { props: { p, token, origin: siteOrigin(req), lang } };
};

export default function SharedScore({ p, token, origin }: Props) {
  const { t, rich, lang } = useI18n();
  const url = `${origin}/s/${token}`;
  const image = `${origin}/api/og?t=${encodeURIComponent(token)}`;
  const playHref = `/?beat=${p.s}&from=${encodeURIComponent(p.n)}`;
  return (
    <>
      {/* Link previews always use the language the score was shared in (p.l). */}
      <SeoHead
        lang={p.l}
        title={shareTitle(p)}
        description={shareDescription(p)}
        url={url}
        image={image}
        imageAlt={translate(p.l, 'share.alt', { name: p.n, score: formatScore(p.s, p.l), felled: p.f })}
        alternates={false}
      />
      <main className="share-page">
        <LangSwitch className="share-lang" />
        <div className="share-card">
          <div className="brand-badge">{t('brand')}</div>
          <p className="share-sub">{t('brand.tagline')}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="share-image" src={image} alt={t('sp.imgAlt', { name: p.n })} width={1200} height={630} />
          <h1 className="share-title">{rich('sp.headline', { name: <span>{p.n}</span>, score: formatScore(p.s, lang) })}</h1>
          <p className="share-desc">
            {t('sp.summary', { felled: p.f, time: formatDuration(p.t, lang), combo: p.c })}
            {p.r > 0 ? t('sp.rare', { n: p.r }) : ''}
          </p>
          <Link className="btn btn-primary btn-xl" href={playHref}>
            {t('sp.play')}
          </Link>
          <Link className="link-muted" href="/trees">
            {t('sp.trees')}
          </Link>
        </div>
      </main>
    </>
  );
}
