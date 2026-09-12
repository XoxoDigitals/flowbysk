import type { ReactNode } from 'react';

/**
 * Studio styles must load in <head> before paint (not useEffect),
 * otherwise .hidden / theme CSS miss the first frame.
 */
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/static/style.css?v=char-loading-2" />
      <link rel="stylesheet" href="/static/whisk.css?v=mobile-1" />
      <link rel="stylesheet" href="/static/storyteller.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulkt2v.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulkt2i.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulki2v.css?v=mobile-2" />
      {children}
    </>
  );
}
