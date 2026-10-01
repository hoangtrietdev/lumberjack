import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { detectServerLang, type Lang } from '@/i18n';
import { useI18n } from '@/i18n/react';

const TreeCatalogView = dynamic(() => import('@/game/ui/TreeCatalogView'), { ssr: false });

export const getServerSideProps: GetServerSideProps<{ lang: Lang }> = async ({ query, req }) => ({
  props: { lang: detectServerLang(query, req.cookies, req.headers['accept-language']) },
});

export default function TreesPage() {
  const { t } = useI18n();
  return (
    <>
      <Head>
        <title>{t('trees.pageTitle')}</title>
        <meta name="description" content={t('trees.pageDesc')} />
      </Head>
      <TreeCatalogView />
    </>
  );
}
