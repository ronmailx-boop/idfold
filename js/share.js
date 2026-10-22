// Receives what another app shared to IDfold (the service worker holds it after the share POST).
// It stays in this page's memory only: it is saved, encrypted, when the user saves the payment.

export function takeShared() {
  if (!new URLSearchParams(location.search).has('share')) return Promise.resolve(null);
  history.replaceState(history.state, '', location.pathname + location.hash);
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      const s = e.data;
      resolve(s && (s.text || s.url || s.title || s.file) ? s : null);
    };
    worker.postMessage('take-share', [channel.port2]);
  });
}
