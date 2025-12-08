# 🗓️ Calendar Sync & Booking App

אפליקציה לסנכרון יומני Google וקביעת פגישות.

## ✨ תכונות

- 📅 **סנכרון יומנים** - בחירת מספר יומנים לסנכרון
- 🕐 **זמנים פנויים** - הצגת זמנים פנויים בכל היומנים שנבחרו
- 📝 **קביעת פגישות** - לקוחות יכולים לקבוע פגישות בזמנים הפנויים
- 🔗 **Webhook** - שליחת פרטי הפגישה לכתובת חיצונית
- ⚙️ **הגדרות גמישות** - משך פגישה, שעות עבודה ועוד

## 🚀 התקנה

### 1. התקנת תלויות

```bash
npm install
```

### 2. הגדרת Google OAuth

1. היכנסו ל-[Google Cloud Console](https://console.cloud.google.com/)
2. צרו פרויקט חדש (או בחרו קיים)
3. הפעילו את **Google Calendar API**:
   - לכו ל-APIs & Services > Library
   - חפשו "Google Calendar API"
   - לחצו Enable
4. צרו OAuth Credentials:
   - לכו ל-APIs & Services > Credentials
   - לחצו "Create Credentials" > "OAuth client ID"
   - בחרו "Web application"
   - הוסיפו Redirect URI: `http://localhost:3000/auth/callback`
   - שמרו את ה-Client ID וה-Client Secret

### 3. הפעלת האפליקציה

```bash
npm start
```

## 📖 שימוש

### דף ניהול (Admin)
- כתובת: `http://localhost:3000/admin.html`
- הזינו את פרטי ה-OAuth (Client ID, Client Secret)
- התחברו ל-Google
- בחרו את היומנים לסנכרון
- הגדירו משך פגישה ושעות עבודה
- הגדירו Webhook (אופציונלי)

### דף הזמנה (לקוחות)
- כתובת: `http://localhost:3000`
- הלקוח רואה את הזמנים הפנויים
- בוחר זמן ומזין פרטים
- הפגישה נוצרת ביומן

## 🔗 Webhook

כאשר נקבעת פגישה, נשלחת בקשת POST לכתובת ה-Webhook עם הפרטים הבאים:

```json
{
  "event": "booking_created",
  "data": {
    "eventId": "google-event-id",
    "eventLink": "https://calendar.google.com/...",
    "slot": {
      "start": "2024-01-15T10:00:00.000Z",
      "end": "2024-01-15T10:30:00.000Z"
    },
    "attendee": {
      "name": "שם הלקוח",
      "email": "email@example.com",
      "phone": "050-0000000",
      "notes": "הערות נוספות"
    },
    "createdAt": "2024-01-14T12:00:00.000Z"
  }
}
```

## 📁 מבנה הפרויקט

```
├── server.js          # שרת Express ו-API
├── config.json        # הגדרות (נוצר אוטומטית)
├── package.json       # תלויות
├── public/
│   ├── index.html     # דף הזמנה ללקוחות
│   └── admin.html     # דף ניהול
└── README.md          # תיעוד
```

## 🛠️ API Endpoints

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/api/config` | קבלת הגדרות |
| POST | `/api/credentials` | שמירת פרטי OAuth |
| POST | `/api/settings` | שמירת הגדרות |
| GET | `/auth/start` | התחלת OAuth flow |
| GET | `/auth/callback` | Callback מ-Google |
| GET | `/api/calendars/list` | רשימת יומנים |
| GET | `/api/availability` | זמנים פנויים |
| POST | `/api/book` | קביעת פגישה |

## 📝 הערות

- המערכת בודקת זמינות ב-14 הימים הקרובים
- סופי שבוע לא מוצגים כזמינים
- הזמנים מוצגים לפי אזור הזמן של ישראל

## 🔒 אבטחה

- פרטי ה-OAuth נשמרים מקומית בקובץ `config.json`
- מומלץ להגן על דף ה-Admin בסביבת Production
- הוסיפו HTTPS בסביבת Production

---

נבנה עם ❤️

