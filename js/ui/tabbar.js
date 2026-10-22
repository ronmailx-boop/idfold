// Bottom tab bar of the home and folder screens: home, search, add, backup, lock.
import { icon } from './icons.js';
import * as autolock from '../autolock.js';

// Set when "search" is pressed outside the home screen; the home screen focuses its field.
let searchWanted = false;
export function takeSearchFocus() {
  const wanted = searchWanted;
  searchWanted = false;
  return wanted;
}

export function tabBar({ home = false } = {}) {
  return `
    <nav class="tabbar" aria-label="ניווט ראשי">
      <div class="tabbar-in">
        <a class="tab" href="#/"${home ? ' aria-current="page"' : ''}>${icon('home')}בית</a>
        <button type="button" class="tab" data-tab-search>${icon('search')}חיפוש</button>
        <button type="button" class="tab-add" data-add aria-label="הוספת מסמך או תשלום">${icon('plus')}</button>
        <a class="tab" href="#/settings">${icon('cloud')}גיבוי</a>
        <button type="button" class="tab" data-tab-lock>${icon('lock')}נעילה</button>
      </div>
    </nav>`;
}

// onSearch runs on the home screen; elsewhere "search" goes home first.
export function bindTabBar(root, { onAdd, onSearch }) {
  root.querySelector('.tabbar [data-add]').onclick = onAdd;
  root.querySelector('[data-tab-lock]').onclick = () => autolock.lockNow();
  root.querySelector('[data-tab-search]').onclick = () => {
    if (onSearch) return onSearch();
    searchWanted = true;
    location.hash = '#/';
  };
}
