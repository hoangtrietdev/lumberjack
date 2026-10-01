import { Html, Head, Main, NextScript, type DocumentProps } from "next/document";

export default function Document(props: DocumentProps) {
  // Pages that detect the language on the server pass it as `pageProps.lang`.
  const lang = props.__NEXT_DATA__?.props?.pageProps?.lang === "en" ? "en" : "vi";
  return (
    <Html lang={lang}>
      <Head>
        <link rel="preload" href="/fonts/BeVietnamPro-ExtraBold.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
