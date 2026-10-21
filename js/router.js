// Hash router: #/  #/folder/<id>  #/settings
// Keeps an in-app stack so "back" follows real navigation history.
const stack = [];
let handler = null;

function current() {
  const [name = '', param = null] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, param: param && decodeURIComponent(param) };
}

function onHashChange() {
  const hash = location.hash || '#/';
  if (stack.at(-2) === hash) stack.pop();
  else if (stack.at(-1) !== hash) stack.push(hash);
  handler(current());
}

export function start(fn) {
  handler = fn;
  addEventListener('hashchange', onHashChange);
  onHashChange();
}

export function back() {
  if (stack.length > 1) history.back();
  else location.replace('#/');
}

export function currentRoute() {
  return current();
}
