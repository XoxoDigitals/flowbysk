import type { ReactNode } from 'react';

/**
 * Studio styles must load in <head> before paint (not useEffect),
 * otherwise .hidden / theme CSS miss the first frame.
 * Inline boot CSS hides the shell until app.js marks studio-ready.
 */
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var d=document.documentElement;d.classList.add('studio-booting');d.classList.remove('studio-ready');d.classList.add('theme-flow-dark');if(document.body){document.body.classList.add('theme-flow-dark');}}catch(e){}})();`,
        }}
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
html.studio-booting, html.studio-booting body,
html:not(.studio-ready) body:has(#studio-boot-skeleton) {
  background: #090b10 !important;
}
/* Hide real shell until boot completes — avoid FOUC / broken flash */
html.studio-booting .studio-next-root,
html.studio-booting .flow-app-shell,
html:not(.studio-ready) .studio-next-root {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
html.studio-ready .studio-next-root {
  visibility: visible !important;
  opacity: 1 !important;
  transition: opacity 0.28s ease;
  pointer-events: auto !important;
}
#studio-boot-skeleton {
  display: flex;
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: #090b10;
  color: #94a3b8;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
  box-sizing: border-box;
  opacity: 1;
}
html.studio-ready #studio-boot-skeleton {
  pointer-events: none;
}
.studio-skel-header {
  height: 52px;
  border-radius: 12px;
  background: linear-gradient(90deg, #141820 25%, #1c2430 50%, #141820 75%);
  background-size: 200% 100%;
  animation: studioSkelShimmer 1.2s ease-in-out infinite;
}
.studio-skel-body { display: flex; gap: 14px; flex: 1; min-height: 0; }
.studio-skel-side {
  width: 220px;
  border-radius: 14px;
  background: #11151c;
  flex-shrink: 0;
}
.studio-skel-main { flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.studio-skel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  flex: 1;
}
@media (min-width: 768px) {
  .studio-skel-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .studio-skel-side { display: none; }
}
.studio-skel-card {
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  background: linear-gradient(90deg, #141820 25%, #1c2430 50%, #141820 75%);
  background-size: 200% 100%;
  animation: studioSkelShimmer 1.2s ease-in-out infinite;
}
.studio-skel-footer {
  height: 72px;
  border-radius: 14px;
  background: #11151c;
}
.studio-skel-label {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  font: 600 13px/1.4 system-ui, sans-serif;
  color: #64748b;
  letter-spacing: 0.02em;
}
@keyframes studioSkelShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.flow-media-card.is-skeleton .card-media-wrapper {
  min-height: 100%;
  background: linear-gradient(90deg, #141820 25%, #1c2430 50%, #141820 75%);
  background-size: 200% 100%;
  animation: studioSkelShimmer 1.2s ease-in-out infinite;
}
.flow-media-card video.is-painting { opacity: 0; }
.flow-media-card video.is-frame-ready { opacity: 1; transition: opacity 0.2s ease; }
`,
        }}
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/static/style.css?v=studio-skel-2" />
      <link rel="stylesheet" href="/static/whisk.css?v=mobile-1" />
      <link rel="stylesheet" href="/static/storyteller.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulkt2v.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulkt2i.css?v=mobile-2" />
      <link rel="stylesheet" href="/static/bulki2v.css?v=biv-8" />
      {children}
    </>
  );
}
