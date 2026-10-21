# IDfold

כספת פשוטה ומוצפנת למסמכי זהות (דרכון, תעודת זהות, רישיון נהיגה ועוד).
אפליקציית PWA סטטית: בלי שרת, בלי Firebase. ההצפנה מתבצעת בדפדפן (Web Crypto API), והגיבוי נשמר מוצפן ב-Google Drive שלך.

כתובת האפליקציה: https://idfold.vplusstudio.app (הכתובת הרשמית, Cloudflare). גם https://ronmailx-boop.github.io/idfold/ ממשיכה לעבוד, אבל לכל כתובת כספת נפרדת במכשיר.

> **סטטוס:** שלב 5 מתוך 6 (סנכרון דו-כיווני מוצפן עם Google Drive ושחזור במכשיר חדש). נעילה מהירה ונעילה אוטומטית יגיעו בשלב 6.

## אבטחה בקצרה

- מפתח נתונים אקראי (256 ביט) מצפין הכול ב-AES-256-GCM, עם IV אקראי לכל הצפנה.
- המפתח נשמר רק כשהוא עטוף פעמיים: במפתח שנגזר מהסיסמה ובמפתח שנגזר מקוד השחזור (PBKDF2-SHA256, 600,000 איטרציות, salt אקראי).
- כל קובץ נשמר מוצפן במכשיר ומפוענח רק בזיכרון לצפייה. תמונות מוקטנות ל-2000 פיקסלים ונשמרות בלי מטא-דאטה (כמו מיקום GPS).
- הגיבוי ב-Drive מוצפן כולו: בתיקייה `IDfold` יש רק `idfold-data.enc` ותיקייה `files` עם קבצים ששמם מזהה אקראי. אין שם שמות, הערות או תוכן גלוי.
- הגישה ל-Drive היא בהרשאה `drive.file` בלבד: האפליקציה רואה רק קבצים שהיא עצמה יצרה.
- שיתוף שולח עותק **לא מוצפן**, ולכן מוצגת אזהרה לפני כל שיתוף.
- שינוי סיסמה עוטף מחדש רק את המפתח — הקבצים לא מוצפנים מחדש.
- **אין דרך לפתוח את הכספת בלי הסיסמה או קוד השחזור.**

## הפעלת GitHub Pages (פעם אחת, מהטלפון)

1. פתח את הריפו ב-GitHub בדפדפן (לא באפליקציה) ← תפריט `⋯` ← **Settings**.
2. בתפריט הצד: **Pages**.
3. תחת **Build and deployment** ← **Source**: בחר `Deploy from a branch`.
4. **Branch**: בחר `main` ותיקייה `/ (root)` ← **Save**.
5. אחרי דקה-שתיים תופיע הכתובת בראש העמוד. פתח אותה בכרום.
6. בכרום: תפריט `⋮` ← **הוספה למסך הבית** / **התקנת אפליקציה**.

## הגדרת Google Drive (פעם אחת, מהטלפון)

כדי שהגיבוי יעבוד צריך "מזהה לקוח" (Client ID) של Google. הוא לא סוד, ומותר שיופיע בקוד.
מומלץ לעבוד בכרום, ואם מסך מסוים לא נוח: תפריט `⋮` ← **אתר למחשב**.

**1. פרויקט**
1. היכנס ל-https://console.cloud.google.com עם חשבון Google שלך ואשר את התנאים.
2. למעלה, ליד הלוגו: בורר הפרויקטים ← **New project** ← שם: `IDfold` ← **Create**.
3. ודא שהפרויקט `IDfold` נבחר בבורר למעלה.

**2. הפעלת Drive API**
1. תפריט `☰` ← **APIs & Services** ← **Library**.
2. חפש `Google Drive API` ← פתח ← **Enable**.

**3. מסך ההסכמה (OAuth consent screen)**
1. תפריט `☰` ← **APIs & Services** ← **OAuth consent screen** (נקרא גם **Google Auth Platform**) ← **Get started**.
2. **App name**: `IDfold`. **User support email**: המייל שלך ← **Next**.
3. **Audience**: בחר **External** ← **Next**.
4. **Contact information**: המייל שלך ← **Next** ← סמן הסכמה ← **Create**.
5. בתפריט הצד: **Data Access** ← **Add or remove scopes** ← בשדה הסינון כתוב `drive.file` ← סמן את `.../auth/drive.file` ← **Update** ← **Save**. אל תוסיף הרשאות אחרות.
6. בתפריט הצד: **Audience** ← **Publish app** ← **Confirm**. הסטטוס צריך להיות **In production**. ההרשאה `drive.file` לא דורשת אימות של Google.

**4. מזהה הלקוח (Client ID)**
1. בתפריט הצד: **Clients** ← **Create client**.
2. **Application type**: `Web application`. **Name**: `IDfold web`.
3. תחת **Authorized JavaScript origins** ← **Add URI** ← `https://idfold.vplusstudio.app` ו-`https://ronmailx-boop.github.io` (בדיוק כך: בלי נתיב ובלי `/` בסוף).
4. אין צורך ב-**Authorized redirect URIs** ← **Create**.
5. העתק את ה-**Client ID** (נגמר ב-`.apps.googleusercontent.com`).

**5. הכנסת המזהה לאפליקציה**
- שלח את ה-Client ID ל-Claude בצ'אט, או ערוך ב-GitHub את `js/config.js` והדבק אותו בין הגרשיים של `GOOGLE_CLIENT_ID`.
- אחרי העדכון: באפליקציה ← הגדרות ← **חבר את Google Drive**. אם מופיעה שגיאה, חכה כמה דקות (שינויים ב-Google לפעמים לוקחים זמן) ונסה שוב.

**מה נשמר ב-Drive:** תיקייה `IDfold` ובה `idfold-data.enc` (כותרת ההצפנה והמפתח העטוף, ואחריהם התיקיות והמסמכים מוצפנים) ותיקייה `files` עם קובץ מוצפן לכל מסמך. התנתקות מפסיקה את הגיבוי ומשאירה את הקבצים המוצפנים ב-Drive.

**סנכרון בין מכשירים:** כל מכשיר מוריד את השינויים של האחרים, ולכל תיקייה ומסמך נשמרת הגרסה האחרונה שנערכה (גם מחיקות). שינוי סיסמה במכשיר אחד עובר לשאר המכשירים בסנכרון הבא. שינויים שנעשו בלי אינטרנט נשמרים וממתינים, ועולים כשהחיבור חוזר.

**שחזור במכשיר חדש:** במסך יצירת הכספת ← **יש לי גיבוי ב-Google Drive** ← התחברות לאותו חשבון Google ← סיסמת ההצפנה (או קוד השחזור, ואז בוחרים סיסמה חדשה).

**אישור החיבור ל-Google:** אפליקציה בלי שרת מקבלת מ-Google גישה לשעה בלבד. לכן אחרי פתיחת הכספת נפתח לרגע חלון של Google ונסגר לבד. אם הדפדפן חסם אותו, הסטטוס יבקש ללחוץ על **סנכרן עכשיו**.

## מבנה

| קובץ | תפקיד |
|---|---|
| `index.html` | מעטפת האפליקציה |
| `sw.js` | Service Worker (עבודה offline) |
| `manifest.webmanifest` | הגדרות התקנה |
| `css/app.css` | עיצוב |
| `js/crypto.js` | הצפנה (Web Crypto בלבד) |
| `js/vault.js` | מצב הכספת: פתיחה, נעילה, שינוי סיסמה |
| `js/store.js` | שכבת הנתונים (תיקיות, מסמכים) — מוצפנת |
| `js/db.js` | IndexedDB |
| `js/router.js` | ניווט בין מסכים |
| `js/files.js` | הכנת קבצים: הקטנת תמונות ותמונה ממוזערת |
| `js/pdf.js` | טעינת pdf.js לתצוגת PDF |
| `js/config.js` | מזהה הלקוח של Google |
| `js/google.js` | התחברות ל-Google (GIS, הטוקן בזיכרון בלבד) |
| `js/drive.js` | קריאות ל-Google Drive API |
| `js/sync.js` | סנכרון מוצפן עם Drive (מיזוג, תור offline, שחזור) |
| `vendor/pdfjs/` | pdf.js 4.10.38 של Mozilla (רישיון Apache-2.0), נשמר בריפו |
| `js/views/` | המסכים |
| `js/ui/` | רכיבים משותפים (אייקונים, bottom sheet) |

## עדכון גרסה

בכל שינוי בקבצים יש להעלות את מספר הגרסה ב-`js/version.js` וב-`CACHE_VERSION` ב-`sw.js`, כדי שהטלפון יוריד את הגרסה החדשה.

## בדיקות

בדיקות ההצפנה רצות ב-Node 20 ומעלה: `npm test`.

## פריסה ל-Cloudflare
כל push ל-`main` מעלה את האתר ל-Cloudflare Workers (`.github/workflows/deploy-cloudflare.yml`, `wrangler.jsonc`). מה שלא עולה לאתר מוגדר ב-`.assetsignore`.
צריך פעם אחת Secret בשם `CLOUDFLARE_API_TOKEN` בריפו (תבנית "Edit Cloudflare Workers"). בלעדיו הפריסה מדלגת ולא נכשלת.
