# IDfold

כספת פשוטה ומוצפנת למסמכי זהות (דרכון, תעודת זהות, רישיון נהיגה ועוד).
אפליקציית PWA סטטית: בלי שרת, בלי Firebase. ההצפנה מתבצעת בדפדפן (Web Crypto API), והגיבוי נשמר מוצפן ב-Google Drive שלך.

כתובת האפליקציה: https://ronmailx-boop.github.io/idfold/

> **סטטוס:** שלב 1 מתוך 6 (שלד ותיקיות). ההצפנה עוד לא פעילה — אל תשמור מסמכים אמיתיים עד שלב 2.

## הפעלת GitHub Pages (פעם אחת, מהטלפון)

1. פתח את הריפו ב-GitHub בדפדפן (לא באפליקציה) ← תפריט `⋯` ← **Settings**.
2. בתפריט הצד: **Pages**.
3. תחת **Build and deployment** ← **Source**: בחר `Deploy from a branch`.
4. **Branch**: בחר `main` ותיקייה `/ (root)` ← **Save**.
5. אחרי דקה-שתיים תופיע הכתובת בראש העמוד. פתח אותה בכרום.
6. בכרום: תפריט `⋮` ← **הוספה למסך הבית** / **התקנת אפליקציה**.

## הגדרת Google Drive

ההוראות (Google Cloud, Drive API, OAuth) יתווספו בשלב 4.

## מבנה

| קובץ | תפקיד |
|---|---|
| `index.html` | מעטפת האפליקציה |
| `sw.js` | Service Worker (עבודה offline) |
| `manifest.webmanifest` | הגדרות התקנה |
| `css/app.css` | עיצוב |
| `js/store.js` | שכבת הנתונים (תיקיות, מסמכים) |
| `js/db.js` | IndexedDB |
| `js/router.js` | ניווט בין מסכים |
| `js/views/` | המסכים |
| `js/ui/` | רכיבים משותפים (אייקונים, bottom sheet) |

## עדכון גרסה

בכל שינוי בקבצים יש להעלות את מספר הגרסה ב-`js/version.js` וב-`CACHE_VERSION` ב-`sw.js`, כדי שהטלפון יוריד את הגרסה החדשה.
