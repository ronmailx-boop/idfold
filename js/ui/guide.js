// First-run guide: a few short steps that explain the app. Shown once after the vault opens
// on this device, and again from the "מדריך שימוש" link on the home screen.
import * as db from '../db.js';
import * as vault from '../vault.js';
import * as google from '../google.js';
import * as sync from '../sync.js';
import { encryptJson, decryptJson } from '../crypto.js';
import { openSheet } from './sheet.js';
import { icon } from './icons.js';

const GUIDE_AAD = 'meta:guide';

// Button names appear as they look in the app.
const ui = (text) => `<span class="guide-ui">${text}</span>`;

const STEPS = [
  {
    icon: 'lock',
    title: 'ברוך הבא ל-IDfold',
    body: `<p>כספת למסמכי הזהות שלך: דרכון, תעודת זהות, רישיון נהיגה ועוד.</p>
      <p>כל מסמך מוצפן במכשיר שלך לפני שהוא נשמר, ורק מי שיודע את הסיסמה יכול לפתוח אותו. גם אנחנו לא.</p>`
  },
  {
    icon: 'folder',
    title: 'מסך הבית',
    body: `<ul>
        <li>המסמכים מסודרים בתיקיות. לחיצה על תיקייה פותחת אותה.</li>
        <li>${ui('תיקייה חדשה')} יוצרת תיקייה עם שם, צבע ואייקון.</li>
        <li>לחיצה ארוכה על תיקייה וגרירה משנות את הסדר.</li>
        <li>שורת החיפוש למעלה מוצאת מסמך לפי השם או ההערה.</li>
      </ul>`
  },
  {
    icon: 'plus',
    title: 'הוספת מסמך',
    body: `<ul>
        <li>לוחצים על ${ui('הוסף מסמך')} בתחתית המסך.</li>
        <li>מצלמים, או בוחרים תמונה או קובץ PDF. אפשר כמה קבצים בבת אחת.</li>
        <li>נותנים שם ובוחרים תיקייה. אפשר להוסיף תאריך תוקף, והאפליקציה תסמן מסמך שתוקפו עומד לפוג, וגם הערה.</li>
      </ul>`
  },
  {
    icon: 'file',
    title: 'צפייה, שיתוף והורדה',
    body: `<ul>
        <li>לחיצה על מסמך פותחת אותו. כפתורי הזכוכית המגדלת מגדילים ומקטינים.</li>
        <li>העיפרון למעלה עורך את השם, התוקף וההערה.</li>
        <li>בתחתית: ${ui('שתף')} (או הורדה למכשיר), ${ui('העבר')} לתיקייה אחרת ו-${ui('מחק')}.</li>
        <li>שיתוף והורדה יוצרים עותק <strong>לא מוצפן</strong>, ולכן מופיעה אזהרה לפני כל אחד מהם.</li>
      </ul>`
  },
  {
    icon: 'cloud',
    title: 'גיבוי ל-Google Drive',
    body: `<p>הגיבוי שומר עותק מוצפן בחשבון Google שלך, כך שאפשר לשחזר הכול אם הטלפון אבד או הוחלף.</p>
      <ol>
        <li>לוחצים על ${ui('לא מחובר')} בראש מסך הבית, או נכנסים להגדרות (גלגל השיניים).</li>
        <li>לוחצים ${ui('חבר את Google Drive')}.</li>
        <li>בוחרים חשבון Google ומאשרים. האפליקציה מקבלת גישה רק לקבצים שהיא עצמה יוצרת.</li>
      </ol>
      <p>מכאן הגיבוי מתעדכן לבד. Google לא יכול לקרוא אותו, כי הוא מוצפן.</p>
      <p>בטלפון חדש: במסך יצירת הכספת לוחצים ${ui('יש לי גיבוי ב-Google Drive')}.</p>`
  },
  {
    icon: 'fingerprint',
    title: 'פתיחה מהירה ונעילה',
    body: `<ul>
        <li>בהגדרות, תחת "אבטחה", אפשר להפעיל פתיחה עם <strong>טביעת אצבע</strong> או עם <strong>קוד PIN</strong>.</li>
        <li>האפליקציה ננעלת לבד אחרי כמה דקות בלי שימוש. את הזמן משנים בהגדרות.</li>
        <li>${ui('נעל עכשיו')} בהגדרות נועל מיד.</li>
      </ul>`
  },
  {
    icon: 'key',
    title: 'חשוב לזכור',
    body: `<p>בלי הסיסמה או קוד השחזור <strong>אין שום דרך</strong> לפתוח את הכספת, גם לא בעזרתנו. שמור את קוד השחזור במקום בטוח, מחוץ לטלפון.</p>
      <p>אפשר לחזור למדריך בכל רגע, מהקישור ${ui('מדריך שימוש')} בתחתית מסך הבית.</p>`
  }
];

async function markSeen() {
  await db.put('meta', { id: 'guide', data: await encryptJson(vault.getKey(), { seen: true }, GUIDE_AAD) });
}

// Opens the guide the first time the vault opens on this device.
export async function showOnce() {
  const rec = await db.get('meta', 'guide');
  const seen = rec && await decryptJson(vault.getKey(), rec.data, GUIDE_AAD).then((p) => p.seen, () => false);
  if (!seen && vault.isOpen() && !document.querySelector('dialog')) openGuide();
}

export function openGuide() {
  let step = 0;
  const d = openSheet({ title: '', label: 'מדריך שימוש' });
  d.classList.add('guide');
  d.addEventListener('close', () => { if (vault.isOpen()) markSeen().catch(() => {}); });

  function render() {
    const s = STEPS[step];
    const last = step === STEPS.length - 1;
    const offerDrive = last && google.isConfigured() && !sync.isConnected();
    d.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="guide-top">
        <span class="guide-count">${step + 1} מתוך ${STEPS.length}</span>
        ${last ? '' : '<button type="button" class="guide-skip" data-close>דלג</button>'}
      </div>
      <span class="guide-icon">${icon(s.icon)}</span>
      <h2 tabindex="-1">${s.title}</h2>
      <div class="guide-body">${s.body}</div>
      <div class="guide-dots" aria-hidden="true">${STEPS.map((_, i) => `<span${i === step ? ' class="on"' : ''}></span>`).join('')}</div>
      <div class="guide-nav">
        ${step ? '<button type="button" class="btn btn-lg btn-secondary" data-prev>הקודם</button>' : ''}
        ${last
          ? `${offerDrive ? `<button type="button" class="btn btn-lg btn-secondary" data-drive>${icon('cloud')}חבר את Google</button>` : ''}
             <button type="button" class="btn btn-lg btn-primary" data-close>סיום</button>`
          : '<button type="button" class="btn btn-lg btn-primary" data-next>הבא</button>'}
      </div>`;
    d.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => d.close(); });
    d.querySelector('[data-next]')?.addEventListener('click', () => go(1));
    d.querySelector('[data-prev]')?.addEventListener('click', () => go(-1));
    const drive = d.querySelector('[data-drive]');
    if (drive) drive.onclick = () => {
      d.close();
      location.hash = '#/settings';
    };
    d.scrollTop = 0;
  }

  function go(delta) {
    step += delta;
    render();
    d.querySelector('h2').focus();
  }

  render();
}
