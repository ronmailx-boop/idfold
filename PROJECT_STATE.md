# PROJECT_STATE — IDfold

## Current Focus
שלב 4 הושלם ומוזג ל-main. חסר: המשתמש צריך ליצור Client ID לפי ה-README ולהכניס אותו ל-`js/config.js` (או לשלוח בצ'אט). ממתין לאישור לפני שלב 5 (סנכרון דו-כיווני, שחזור במכשיר חדש, offline queue, רענון טוקן שקט).

## החלטות
- אחרי כל שלב: commit לענף העבודה ומיזוג ל-`main` (בקשת המשתמש: "תמיד אתה תמזג ל-main").
- מחיקת תיקייה: המסמכים שבה עוברים לתיקייה "אחר". את "אחר" (`keep: true`) אי אפשר למחוק.
- רשומות ב-IndexedDB בפורמט `{ id, data: { iv, ct } }` (AES-256-GCM, AAD = `<store>:<id>`). ה-id הוא UUID אקראי.
- כותרת הכספת (`meta/vault`) גלויה: `{ v: 1, wraps: { password, recovery } }`, לכל wrap: `kdf {PBKDF2, SHA-256, iterations, salt}`, `iv`, `ct`. ה-AAD של wrap הוא `idfold/v1/dek/<slot>`. אותה כותרת תיכנס ל-idfold-data.enc בשלב 4.
- ה-DEK בזיכרון כ-CryptoKey שאינו ניתן לייצוא. עטיפה מחדש דורשת את הסיסמה הנוכחית (או את קוד השחזור), ואז ה-DEK הגולמי נמחק (`fill(0)`).
- קוד שחזור: 24 תווים ב-Crockford base32 (120 ביט), בקבוצות של 4. אחרי פתיחה עם קוד שחזור חובה לבחור סיסמה חדשה.
- סיסמה: מינימום 10 תווים וחוזק לפחות "בינונית" (`js/strength.js`).
- בדיקות: `npm test` (Node, `tests/crypto.test.mjs`). בדיקת e2e עם Playwright רצה מה-scratchpad ולא נשמרה בריפו.
- בשלב 6: לנעילה מהירה (PIN/WebAuthn) צריך להוסיף slot שלישי ל-wraps (מקומי בלבד, לא לסנכרן).
- מחיקה משאירה tombstone (`{ id, deleted: true, updatedAt }`) לטובת הסנכרון בשלב 5.
- ניווט מבוסס hash (`#/`, `#/folder/<id>`, `#/settings`), עם מחסנית פנימית לכפתור "חזרה".
- bottom sheets מבוססים על `<dialog>`.
- בכל שינוי: להעלות את `APP_VERSION` (`js/version.js`) ואת `CACHE_VERSION` (`sw.js`).
- CSP ב-meta ב-`index.html`. בשלב 4 צריך להוסיף את `accounts.google.com` ו-`www.googleapis.com`.

- מסמך: `{ id, folderId, name, note, expiry, mime, size, thumb, createdAt, updatedAt }`. ה-thumb הוא JPEG בגודל 128x160 כ-data URL בתוך הרשומה המוצפנת. הקובץ עצמו נשמר ב-`blobs` עם אותו id (AAD `blobs:<id>`), ונכתב לפני רשומת המסמך.
- תמונות מקודדות מחדש ל-JPEG (צד ארוך עד 2000px, איכות 0.88), מה שמסיר EXIF. אם הדפדפן לא מצליח לפענח (למשל HEIC באנדרואיד) נשמר הקובץ המקורי. ה-PDF נשמר כמו שהוא. מגבלה: 25MB לקובץ.
- pdf.js 4.10.38 (legacy build) נמצא ב-`vendor/pdfjs/` ונטען רק כשצריך, עם `isEvalSupported: false`. אין צורך לשנות את ה-CSP.
- מסך יכול להחזיר `{ cleanup, refresh }`. במסך הצפייה `refresh` רק מעדכן את הכותרת, ו-`cleanup` מבטל את ה-Blob URL ומשחרר את הקובץ המפוענח.
- שיתוף: ה-File מוכן מראש, ו-`navigator.share` נקרא ישירות מהלחיצה על "שתף בכל זאת".
- בדיקת e2e לשלב 3: `e2e3.mjs` ב-scratchpad (לא בריפו).

- שלב 4: GIS token client (`js/google.js`), הטוקן בזיכרון בלבד. בקשת טוקן רק מלחיצה (חלון Google). בלי טוקן הגיבוי האוטומטי עובר ל"ממתין" עם בקשה ללחוץ "סנכרן עכשיו".
- מבנה ב-Drive: `IDfold/idfold-data.enc` = JSON `{ app:'idfold', v:1, header, data:{iv,ct} }`, ה-data הוא `{ folders, docs }` כולל tombstones, מוצפן עם AAD `idfold-data` ו-IV חדש בכל כתיבה. `IDfold/files/<docId>` = IV(12) ואחריו ה-ciphertext מהרשומה המקומית (AAD `blobs:<id>`).
- סדר גיבוי: קבצים חסרים ← קובץ הנתונים ← מחיקת קבצים מיותרים (מסמכים שנמחקו). בכל גיבוי משווים לרשימת `files` ב-Drive (אין מפת העלאות מקומית).
- מצב החיבור נשמר מוצפן ב-`meta/sync` (AAD `meta:sync`): `{ email, rootId, filesId, dataId, pending, lastBackup }`.
- אם ב-Drive יש `idfold-data.enc` שלא נפתח במפתח הנוכחי (כספת אחרת) — לא דורסים, החיבור מבוטל עם הודעה.
- שגיאות Drive: 401 → auth, 404 → חיפוש תיקיות מחדש, 429/5xx/rateLimit → backoff עד 4 ניסיונות, storageQuota → quota, שגיאת רשת → offline.
- בשלב 6: ה-header שעולה ל-Drive (`vault.getHeader()`) חייב לסנן את ה-slot המקומי של PIN/WebAuthn.
- CSP: נוספו `accounts.google.com/gsi/*` ו-`www.googleapis.com`. בדיקת e2e לשלב 4: `e2e4.mjs` ב-scratchpad, עם Drive מדומה.

## שלבים
- [x] 1. שלד PWA + IndexedDB + תיקיות עם עריכה מלאה (הוספה, שם, אייקון/צבע, מחיקה, גרירה)
- [x] 2. מודול הצפנה: סיסמה, קוד שחזור, DEK עטוף פעמיים, מסך נעילה, שינוי סיסמה, בדיקות (מחיקת נתוני שלב 1 הלא-מוצפנים)
- [x] 3. הוספת קבצים מהבורר, שמירה מוצפנת, צפייה (zoom, pdf.js), שיתוף, חיפוש
- [x] 4. התחברות Google (drive.file), תיקיית IDfold וגיבוי חד-כיווני + הוראות הקמה ל-Google Cloud
- [ ] 5. סנכרון דו-כיווני ומיזוג, offline queue, חיווי סטטוס
- [ ] 6. נעילה מהירה (PIN + WebAuthn PRF), נעילה אוטומטית, ליטוש PWA
