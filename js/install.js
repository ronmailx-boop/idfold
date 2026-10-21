// "Add to home screen": Chrome/Android offers a prompt; iPhone needs Safari's share menu.
let deferred = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
});
addEventListener('appinstalled', () => { deferred = null; });

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 'prompt' (the browser can install), 'ios' (show the Safari steps), or null.
export function installMode() {
  if (standalone()) return null;
  if (deferred) return 'prompt';
  return ios() ? 'ios' : null;
}

export async function install() {
  const e = deferred;
  deferred = null;
  if (!e) return false;
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
