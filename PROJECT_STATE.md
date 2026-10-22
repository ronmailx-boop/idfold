# PROJECT_STATE — IDfold

## Current Focus
שלב 6 הושלם ומוזג ל-main; גרסה 0.6.1 הוסיפה כפתור "הורד למכשיר" ליד השיתוף — כל 6 השלבים גמורים. האתר: https://idfold.vplusstudio.app (Cloudflare, נפרס אוטומטית מ-main; גם github.io פעיל). באתר האפליקציות (ריפו my-site) האריח של IDfold פותח את idfold.vplusstudio.app. Google OAuth: פרויקט IDfold, External במצב Testing, משתמשי בדיקה vplusstudio.app@gmail.com ו-ronmailx@gmail.com, origins לשתי הכתובות. הבא: בדיקה אמיתית בטלפון (התחברות ל-Google, סנכרון, טביעת אצבע); לא נבדק עדיין מול Google אמיתי ומול חיישן אמיתי. אפשרויות להמשך: Publish app ב-Google Auth Platform כשרוצים משתמשים מעבר למשתמשי הבדיקה, מסמכים משפטיים ב-docs/legal.

## החלטות
- אירוח: הכתובת הרשמית https://idfold.vplusstudio.app (Cloudflare Workers static assets, workers_dev נשאר פעיל). GitHub Pages נשאר במקביל. ה-SW שומר במטמון עותק לא-מופנה (`unredirect`) כי Cloudflare מפנה index.html ל-`/`.
- אחרי כל שלב: commit לענף העבודה ומיזוג ל-`main` (בקשת המשתמש: "תמיד אתה תמזג ל-main").
- מחיקת תיקייה: המסמכים שבה עוברים לתיקייה "אחר". את "אחר" (`keep: true`) אי אפשר למחוק.
- רשומות ב-IndexedDB בפורמט `{ id, data: { iv, ct } }` (AES-256-GCM, AAD = `<store>:<id>`). ה-id הוא UUID אקראי.
- כותרת הכספת (`meta/vault`) גלויה: `{ v: 1, wraps: { password, recovery } }`, לכל wrap: `kdf {PBKDF2, SHA-256, iterations, salt}`, `iv`, `ct`. ה-AAD של wrap הוא `idfold/v1/dek/<slot>`. אותה כותרת תיכנס ל-idfold-data.enc בשלב 4.
- ה-DEK בזיכרון כ-CryptoKey שאינו ניתן לייצוא. עטיפה מחדש דורשת את הסיסמה הנוכחית (או את קוד השחזור), ואז ה-DEK הגולמי נמחק (`fill(0)`).
- קוד שחזור: 24 תווים ב-Crockford base32 (120 ביט), בקבוצות של 4. אחרי פתיחה עם קוד שחזור חובה לבחור סיסמה חדשה.
- סיסמה: מינימום 10 תווים וחוזק לפחות "בינונית" (`js/strength.js`).
- בדיקות: `npm test` (Node, `tests/crypto.test.mjs`). בדיקת e2e עם Playwright רצה מה-scratchpad ולא נשמרה בריפו.
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
- הורדה (0.6.1): באותו חלון אזהרה יש גם "הורד למכשיר" (blob URL + `<a download>`, ה-URL משוחרר אחרי דקה). כשאין תמיכה בשיתוף קבצים נשאר רק כפתור ההורדה. חלון השיתוף של אנדרואיד שייך למערכת ואי אפשר להוסיף אליו כפתורים. בדיקת e2e: `e2e7.mjs` ב-scratchpad (להריץ עם `LANG=C.UTF-8`, אחרת Chromium נותן לשם עברי `download`).
- בדיקת e2e לשלב 3: `e2e3.mjs` ב-scratchpad (לא בריפו).

- שלב 4: GIS token client (`js/google.js`), הטוקן בזיכרון בלבד. בקשת טוקן רק מלחיצה (חלון Google). בלי טוקן הגיבוי האוטומטי עובר ל"ממתין" עם בקשה ללחוץ "סנכרן עכשיו".
- מבנה ב-Drive: `IDfold/idfold-data.enc` = JSON `{ app:'idfold', v:1, header, data:{iv,ct} }`, ה-data הוא `{ folders, docs }` כולל tombstones, מוצפן עם AAD `idfold-data` ו-IV חדש בכל כתיבה. `IDfold/files/<docId>` = IV(12) ואחריו ה-ciphertext מהרשומה המקומית (AAD `blobs:<id>`).
- סדר גיבוי: קבצים חסרים ← קובץ הנתונים ← מחיקת קבצים מיותרים (מסמכים שנמחקו). בכל גיבוי משווים לרשימת `files` ב-Drive (אין מפת העלאות מקומית).
- מצב החיבור נשמר מוצפן ב-`meta/sync` (AAD `meta:sync`): `{ email, rootId, filesId, dataId, pending, lastBackup }`.
- אם ב-Drive יש `idfold-data.enc` שלא נפתח במפתח הנוכחי (כספת אחרת) — לא דורסים, החיבור מבוטל עם הודעה.
- שגיאות Drive: 401 → auth, 404 → חיפוש תיקיות מחדש, 429/5xx/rateLimit → backoff עד 4 ניסיונות, storageQuota → quota, שגיאת רשת → offline.
- CSP: נוספו `accounts.google.com/gsi/*` ו-`www.googleapis.com`. בדיקת e2e לשלב 4: `e2e4.mjs` ב-scratchpad, עם Drive מדומה.

- שלב 5 — סדר כל ריצת סנכרון (`syncWith`): תיקיות ← pull (רק אם `version` של קובץ הנתונים ב-Drive השתנה מ-`state.dataVersion`) ← מיזוג כותרת ונתונים ← הורדת קבצים חסרים מקומית ← העלאת קבצים חסרים ב-Drive ← בדיקת version שוב ומיזוג אם השתנה (מניעת דריסה בין מכשירים) ← העלאת קובץ הנתונים רק אם המכשיר "מקדים" ← מחיקת קבצים מיותרים (רק אם עדיין לא חיים אחרי המיזוג המאוחר).
- מיזוג (`store.merge`): לכל id מנצח ה-`updatedAt` הגבוה (כולל tombstones); תיקו = המקומי נשאר. פריטים מרוחקים עוברים ניקוי (`cleanRemote`). מסמך שהתיקייה שלו נמחקה עובר ל"אחר". emit עם `{ remote: true }`, וה-sync מתעלם ממנו (בלי לולאה).
- כותרת הכספת: שדה `at` = זמן השינוי, מוצפן ב-DEK עם AAD שקשור ל-wraps (password+recovery בלבד). הכותרת החדשה יותר מנצחת; כותרת מרוחקת נשמרת כמו שהיא (`vault.adoptHeader`) ומוצגת הודעה. כותרות ישנות בלי `at` = 0.
- מצב סנכרון: `{ email, rootId, filesId, dataId, dataVersion, pending, lastBackup }`. ה-listeners של הסנכרון נרשמים בטעינת המודול (חשוב לשחזור עם קוד שחזור, שבו הסיסמה משתנה לפני `init`).
- offline queue: `pending` נשמר מוצפן; שגיאות offline/rate/failed/quota מתוזמנות מחדש (30ש' עד 10ד'); סנכרון גם ב-`online` וב-`visibilitychange` (כשיש טוקן).
- טוקן: אין רענון שקט אמיתי בלי שרת. החידוש קורה בלחיצת "פתח את הכספת" (`sync.resume`, GIS נטען מראש במסך הנעילה, `login_hint` = המייל) או ב"סנכרן עכשיו". אם החלון נחסם: הודעת auth שקטה.
- שחזור (`views/restore.js`): `sync.findBackup` (לחיצה) ← `vault.unlockBackup` ← `sync.restore`: ייבוא הנתונים, שמירת מצב, ורק בסוף `adoptHeader` (שחזור שנקטע מתחיל מחדש). קבצים שלא ירדו יורדים בסנכרון הבא. `vault.create` מוחק גם את `meta/sync`.
- בדיקת e2e לשלב 5: `e2e5.mjs` ב-scratchpad (4 מכשירים מול Drive מדומה עם `version`).

- שלב 6, פתיחה מהירה: במקום slot שלישי בכותרת (שהיה מחייב סינון לפני העלאה), העטיפות המקומיות ברשומה נפרדת `meta/quick` (גלויה, כמו הכותרת): `{ pin?: { wrap, fails }, bio?: { credId, evalSalt, wrap }, passwordAt }`. AAD של עטיפה: `idfold/v1/dek/pin` / `idfold/v1/dek/prf`. PIN: PBKDF2 600k, 6–12 ספרות, חוסם רצפים/ספרה חוזרת, 5 ניסיונות (נספר לפני הניסיון) ואז העטיפה נמחקת. PRF: passkey מקומי (platform, UV required, rpId = hostname), salt קבוע לכל credential, HKDF-SHA256 → AES-GCM. הפעלה דורשת סיסמה (ה-DEK בזיכרון לא ניתן לייצוא). כל בקשת טביעת אצבע בלחיצה נפרדת (Safari). `vault.create` ו-`sync.restore` מוחקים את `meta/quick`. כל 14 יום נדרשת סיסמה מלאה.
- שלב 6, נעילה: `autolock.js` סופר זמן מאז אינטראקציה אחרונה (pointerdown/keydown/wheel/touchmove), בודק כל 15 שניות ובחזרה מהרקע. בחירה 1/5/15/60 דקות (ברירת מחדל 5) מוצפנת ב-`meta/prefs` (AAD `meta:prefs`). `lockNow` ב-app.js: סוגר dialogs, cleanup למסך, `sync.suspend()`, `google.dropToken()`, `store.clearMemory()`, איפוס חיפוש, `vault.lock()`. עדכון SW שהגיע כשהכספת פתוחה נטען בנעילה הבאה. ברקע `body.away` מסתיר את התוכן.
- שלב 6, מנהל סיסמאות: שדה `username` נסתר עם הערך IDfold בכל טופס סיסמה (`usernameField()`), ולא בטפסי PIN.
- בדיקת e2e לשלב 6 (scratchpad `e2e6.mjs`): Virtual Authenticator עם PRF דרך CDP, `page.clock` לנעילה אוטומטית — 32 בדיקות עוברות.

## שלבים
- [x] 1. שלד PWA + IndexedDB + תיקיות עם עריכה מלאה (הוספה, שם, אייקון/צבע, מחיקה, גרירה)
- [x] 2. מודול הצפנה: סיסמה, קוד שחזור, DEK עטוף פעמיים, מסך נעילה, שינוי סיסמה, בדיקות (מחיקת נתוני שלב 1 הלא-מוצפנים)
- [x] 3. הוספת קבצים מהבורר, שמירה מוצפנת, צפייה (zoom, pdf.js), שיתוף, חיפוש
- [x] 4. התחברות Google (drive.file), תיקיית IDfold וגיבוי חד-כיווני + הוראות הקמה ל-Google Cloud
- [x] 5. סנכרון דו-כיווני ומיזוג, שחזור במכשיר חדש, offline queue, חיווי סטטוס
- [x] 6. נעילה מהירה (PIN + WebAuthn PRF), נעילה אוטומטית, ליטוש PWA (שם משתמש נסתר, התקנה במסך הבית, עדכון בנעילה, הסתרה ברקע)
