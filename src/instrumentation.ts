/**
 * Next.js instrumentation — start proxy auto-rotate loop with the Node server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const { startProxyAutoRotateLoop } = await import('./lib/proxyAutoRotate');
    startProxyAutoRotateLoop();
  } catch (e) {
    console.warn('[instrumentation] proxy auto-rotate:', e);
  }
}
