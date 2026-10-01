import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import SeoHead from '@/components/SeoHead';
import { sanitizeName } from '@/game/logic/share';
import { detectServerLang, translate, type Lang } from '@/i18n';
import { useI18n } from '@/i18n/react';
import { siteOrigin } from '@/server/shareToken';

const GameApp = dynamic(() => import('@/game/ui/GameApp'), {
  ssr: false,
  loading: () => <div className="boot">…</div>,
});

interface Props {
  origin: string;
  lang: Lang;
  challenge: { score: number; from: string } | null;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, query }) => {
  const beat = Number(query.beat);
  const from = sanitizeName(query.from);
  return {
    props: {
      origin: siteOrigin(req),
      lang: detectServerLang(query, req.cookies, req.headers['accept-language']),
      // An empty `from` is shown as "a friend" in the current language.
      challenge: Number.isFinite(beat) && beat > 0 && beat < 10_000_000 ? { score: Math.floor(beat), from } : null,
    },
  };
};

export default function Home({ origin, challenge }: Props) {
  // Same as props.lang on the server; follows the in-game language switch on the client.
  const { lang } = useI18n();
  return (
    <>
      <SeoHead
        lang={lang}
        title={translate(lang, 'meta.title')}
        description={translate(lang, 'meta.desc')}
        url={`${origin}/`}
        image={`${origin}/api/og?lang=${lang}`}
        imageAlt={translate(lang, 'meta.alt')}
      />
      <GameApp challenge={challenge} />
    </>
  );
}
