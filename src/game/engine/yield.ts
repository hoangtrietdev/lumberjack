/**
 * Lets the browser paint between chunks of heavy work. Uses requestAnimationFrame
 * while the tab is visible, and a MessageChannel tick when it is hidden
 * (background tabs pause rAF, which would otherwise freeze loading).
 */
export function yieldToBrowser(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });
}
