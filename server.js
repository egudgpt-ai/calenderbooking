/**
 * ============================================================================
 * אפליקציית סנכרון יומנים וקביעת פגישות - Multi Advisor
 * ============================================================================
 * 
 * תיאור כללי:
 * -----------
 * אפליקציה זו מאפשרת ניהול מספר יועצים, כאשר כל יועץ יכול לחבר את יומן Google
 * שלו ולאפשר ללקוחות לקבוע איתו פגישות. כל הפגישות נשלחות ל-Webhook מרכזי.
 * 
 * זרימת העבודה:
 * -------------
 * 1. מנהל המערכת מגדיר את פרטי Google OAuth ו-Webhook
 * 2. מנהל המערכת מוסיף יועצים ושולח להם קישור הגדרה
 * 3. כל יועץ מתחבר ליומן Google שלו ובוחר יומנים לסנכרון
 * 4. לקוחות נכנסים לקישור ההזמנה של היועץ וקובעים פגישה
 * 5. הפגישה נוצרת ביומן היועץ ונשלחת התראה ל-Webhook
 * 
 * קבצי הפרויקט:
 * -------------
 * - server.js - השרת הראשי (קובץ זה)
 * - public/admin.html - דף ניהול המערכת
 * - public/setup.html - דף הגדרת יועץ
 * - public/book.html - דף קביעת פגישה ללקוחות
 * - config.json - הגדרות המערכת (נוצר אוטומטית)
 * - advisors.json - מידע על היועצים (נוצר אוטומטית)
 * 
 * @author Calendar Booking App
 * @version 2.0.0
 */

// ============================================================================
// ייבוא ספריות
// ============================================================================

const express = require('express');      // פריימוורק לשרת HTTP
const { google } = require('googleapis'); // ספריית Google APIs
const cors = require('cors');             // מאפשר בקשות Cross-Origin
const bodyParser = require('body-parser'); // פענוח גוף הבקשות
const axios = require('axios');           // שליחת בקשות HTTP
const path = require('path');             // עבודה עם נתיבי קבצים
const fs = require('fs');                 // עבודה עם מערכת הקבצים

// ============================================================================
// אתחול האפליקציה
// ============================================================================

const app = express();

// הגדרת Middleware
app.use(cors());                          // מאפשר בקשות מכל דומיין
app.use(bodyParser.json());               // פענוח JSON בגוף הבקשות
app.use(express.static('public'));        // הגשת קבצים סטטיים מתיקיית public

// ============================================================================
// נתיבי קבצי ההגדרות
// ============================================================================

/** נתיב לקובץ ההגדרות הראשי - מכיל פרטי OAuth ו-Webhook */
const CONFIG_FILE = path.join(__dirname, 'config.json');

/** נתיב לקובץ היועצים - מכיל את כל המידע על היועצים */
const ADVISORS_FILE = path.join(__dirname, 'advisors.json');

// ============================================================================
// פונקציות ניהול הגדרות
// ============================================================================

/**
 * טוען את ההגדרות הראשיות מהקובץ
 * -----------------------------
 * הגדרות אלו כוללות:
 * - webhookUrl: כתובת ה-Webhook לשליחת התראות על פגישות
 * - credentials: פרטי Google OAuth (clientId, clientSecret, redirectUri)
 * 
 * @returns {Object} אובייקט ההגדרות, או אובייקט ברירת מחדל אם הקובץ לא קיים
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('שגיאה בטעינת קובץ ההגדרות:', error);
    }
    // ברירת מחדל - הגדרות ריקות
    return {
        webhookUrl: '',
        credentials: null
    };
}

/**
 * שומר את ההגדרות הראשיות לקובץ
 * -----------------------------
 * @param {Object} config - אובייקט ההגדרות לשמירה
 */
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * טוען את רשימת היועצים מהקובץ
 * ----------------------------
 * כל יועץ מכיל:
 * - name: שם היועץ
 * - email: כתובת האימייל (מתמלא אחרי החיבור ל-Google)
 * - tokens: טוקנים של Google OAuth
 * - calendars: רשימת היומנים שנבחרו לסנכרון
 * - meetingDuration: משך פגישה בדקות
 * - workingHours: שעות העבודה {start, end}
 * 
 * @returns {Object} אובייקט עם כל היועצים (מפתח = מזהה יועץ)
 */
function loadAdvisors() {
    try {
        if (fs.existsSync(ADVISORS_FILE)) {
            const data = fs.readFileSync(ADVISORS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('שגיאה בטעינת קובץ היועצים:', error);
    }
    return {};
}

/**
 * שומר את רשימת היועצים לקובץ
 * ---------------------------
 * @param {Object} advisors - אובייקט היועצים לשמירה
 */
function saveAdvisors(advisors) {
    fs.writeFileSync(ADVISORS_FILE, JSON.stringify(advisors, null, 2));
}

// ============================================================================
// טעינת ההגדרות בהפעלה
// ============================================================================

/** הגדרות המערכת הראשיות */
let config = loadConfig();

/** רשימת היועצים */
let advisors = loadAdvisors();

// ============================================================================
// פונקציות Google OAuth
// ============================================================================

/**
 * יוצר לקוח OAuth2 לחיבור ל-Google
 * ---------------------------------
 * הלקוח משמש לאימות מול Google ולביצוע פעולות ב-Calendar API.
 * 
 * @param {string|null} advisorId - מזהה היועץ (אופציונלי)
 *                                  אם מסופק, הטוקנים של היועץ יוגדרו בלקוח
 * @returns {OAuth2Client|null} לקוח OAuth2 או null אם אין פרטי התחברות
 */
function getOAuth2Client(advisorId = null) {
    // בדיקה שיש פרטי התחברות מוגדרים
    if (!config.credentials) {
        return null;
    }
    
    // יצירת לקוח OAuth2 עם פרטי ההתחברות
    const oauth2Client = new google.auth.OAuth2(
        config.credentials.clientId,
        config.credentials.clientSecret,
        config.credentials.redirectUri || `${getBaseUrl()}/auth/callback`
    );
    
    // אם צוין יועץ ויש לו טוקנים - הגדר אותם בלקוח
    if (advisorId && advisors[advisorId] && advisors[advisorId].tokens) {
        oauth2Client.setCredentials(advisors[advisorId].tokens);
    }
    
    return oauth2Client;
}

/**
 * מחזיר את כתובת הבסיס של האפליקציה
 * ----------------------------------
 * משמש ליצירת קישורים מלאים (לדוגמה: קישור callback של OAuth)
 * 
 * סדר עדיפות:
 * 1. RENDER_EXTERNAL_URL - כתובת מ-Render
 * 2. BASE_URL - כתובת מוגדרת ידנית
 * 3. localhost - ברירת מחדל לפיתוח
 * 
 * @returns {string} כתובת הבסיס של האפליקציה
 */
function getBaseUrl() {
    return process.env.RENDER_EXTERNAL_URL || 
           process.env.BASE_URL || 
           'http://localhost:3000';
}

// ============================================================================
// נתיבי API - ניהול המערכת (Admin)
// ============================================================================

/**
 * GET /api/config
 * ---------------
 * מחזיר את הגדרות המערכת הנוכחיות
 * 
 * תגובה:
 * - webhookUrl: כתובת ה-Webhook
 * - hasCredentials: האם יש פרטי Google OAuth
 * - baseUrl: כתובת הבסיס של האפליקציה
 */
app.get('/api/config', (req, res) => {
    res.json({
        webhookUrl: config.webhookUrl,
        hasCredentials: !!config.credentials,
        baseUrl: getBaseUrl()
    });
});

/**
 * POST /api/credentials
 * ---------------------
 * שומר את פרטי Google OAuth
 * 
 * פרמטרים בגוף הבקשה:
 * - clientId: מזהה הלקוח מ-Google Cloud Console
 * - clientSecret: הסוד של הלקוח
 * - redirectUri: כתובת ה-Callback (אופציונלי)
 */
app.post('/api/credentials', (req, res) => {
    const { clientId, clientSecret, redirectUri } = req.body;
    
    config.credentials = {
        clientId,
        clientSecret,
        redirectUri: redirectUri || `${getBaseUrl()}/auth/callback`
    };
    
    saveConfig(config);
    res.json({ success: true });
});

/**
 * POST /api/webhook
 * -----------------
 * שומר את כתובת ה-Webhook
 * 
 * פרמטרים בגוף הבקשה:
 * - webhookUrl: כתובת ה-Webhook לשליחת התראות
 */
app.post('/api/webhook', (req, res) => {
    const { webhookUrl } = req.body;
    config.webhookUrl = webhookUrl;
    saveConfig(config);
    res.json({ success: true });
});

/**
 * GET /api/advisors
 * -----------------
 * מחזיר את רשימת כל היועצים במערכת
 * 
 * תגובה: מערך של יועצים, כל יועץ מכיל:
 * - id: מזהה ייחודי
 * - name: שם היועץ
 * - email: כתובת אימייל
 * - isConnected: האם מחובר ל-Google
 * - meetingDuration: משך פגישה
 * - workingHours: שעות עבודה
 */
app.get('/api/advisors', (req, res) => {
    const advisorList = Object.entries(advisors).map(([id, data]) => ({
        id,
        name: data.name,
        email: data.email,
        isConnected: !!data.tokens,
        meetingDuration: data.meetingDuration || 30,
        workingHours: data.workingHours || { start: 9, end: 17 }
    }));
    res.json(advisorList);
});

/**
 * POST /api/advisors
 * ------------------
 * יוצר יועץ חדש במערכת
 * 
 * פרמטרים בגוף הבקשה:
 * - name: שם היועץ
 * 
 * תגובה:
 * - success: האם הפעולה הצליחה
 * - id: מזהה היועץ שנוצר
 * - setupLink: קישור להגדרת היועץ
 */
app.post('/api/advisors', (req, res) => {
    const { name } = req.body;
    
    // וידוא שהוזן שם
    if (!name) {
        return res.status(400).json({ error: 'נא להזין שם' });
    }
    
    // יצירת מזהה ייחודי מהשם
    // מסיר תווים מיוחדים ומחליף רווחים במקפים
    const id = name.toLowerCase()
        .replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '-')  // תווים מותרים: אותיות, מספרים, עברית
        .replace(/-+/g, '-')                          // מקף כפול -> מקף בודד
        .replace(/^-|-$/g, '')                        // הסרת מקפים בהתחלה/סוף
        || 'advisor-' + Date.now();                   // ברירת מחדל אם השם ריק
    
    // בדיקה שהיועץ לא קיים
    if (advisors[id]) {
        return res.status(400).json({ error: 'יועץ עם שם זה כבר קיים' });
    }
    
    // יצירת היועץ עם ערכי ברירת מחדל
    advisors[id] = {
        name,
        email: null,              // יתמלא אחרי חיבור ל-Google
        tokens: null,             // טוקנים של Google OAuth
        calendars: [],            // יומנים שנבחרו לסנכרון
        meetingDuration: 30,      // משך פגישה - 30 דקות
        workingHours: { start: 9, end: 17 }  // שעות עבודה 9:00-17:00
    };
    
    saveAdvisors(advisors);
    
    res.json({ 
        success: true, 
        id,
        setupLink: `${getBaseUrl()}/setup/${id}`
    });
});

/**
 * DELETE /api/advisors/:id
 * ------------------------
 * מוחק יועץ מהמערכת
 * 
 * פרמטרים:
 * - id: מזהה היועץ למחיקה (בנתיב)
 */
app.delete('/api/advisors/:id', (req, res) => {
    const { id } = req.params;
    
    if (advisors[id]) {
        delete advisors[id];
        saveAdvisors(advisors);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'יועץ לא נמצא' });
    }
});

// ============================================================================
// נתיבי API - הגדרת יועץ (Setup)
// ============================================================================

/**
 * GET /api/advisor/:id
 * --------------------
 * מחזיר את פרטי יועץ ספציפי
 * 
 * פרמטרים:
 * - id: מזהה היועץ (בנתיב)
 * 
 * תגובה: אובייקט עם כל פרטי היועץ
 */
app.get('/api/advisor/:id', (req, res) => {
    const { id } = req.params;
    const advisor = advisors[id];
    
    if (!advisor) {
        return res.status(404).json({ error: 'יועץ לא נמצא' });
    }
    
    res.json({
        id,
        name: advisor.name,
        email: advisor.email,
        isConnected: !!advisor.tokens,
        calendars: advisor.calendars || [],
        meetingDuration: advisor.meetingDuration || 30,
        workingHours: advisor.workingHours || { start: 9, end: 17 },
        bookingLink: `${getBaseUrl()}/book/${id}`
    });
});

/**
 * POST /api/advisor/:id/settings
 * ------------------------------
 * מעדכן את הגדרות היועץ
 * 
 * פרמטרים בנתיב:
 * - id: מזהה היועץ
 * 
 * פרמטרים בגוף הבקשה:
 * - calendars: רשימת יומנים לסנכרון [{id, name}]
 * - meetingDuration: משך פגישה בדקות
 * - workingHours: שעות עבודה {start, end}
 */
app.post('/api/advisor/:id/settings', (req, res) => {
    const { id } = req.params;
    const { calendars, meetingDuration, workingHours } = req.body;
    
    if (!advisors[id]) {
        return res.status(404).json({ error: 'יועץ לא נמצא' });
    }
    
    // עדכון רק השדות שנשלחו
    if (calendars) advisors[id].calendars = calendars;
    if (meetingDuration) advisors[id].meetingDuration = meetingDuration;
    if (workingHours) advisors[id].workingHours = workingHours;
    
    saveAdvisors(advisors);
    res.json({ success: true });
});

/**
 * GET /auth/start/:advisorId
 * --------------------------
 * מתחיל את תהליך ההתחברות ל-Google עבור יועץ
 * 
 * פרמטרים:
 * - advisorId: מזהה היועץ (בנתיב)
 * 
 * התהליך:
 * 1. יוצר URL להתחברות ל-Google
 * 2. מעביר את המשתמש לדף ההתחברות של Google
 * 3. Google מחזיר את המשתמש ל-/auth/callback
 */
app.get('/auth/start/:advisorId', (req, res) => {
    const { advisorId } = req.params;
    
    // וידוא שהיועץ קיים
    if (!advisors[advisorId]) {
        return res.status(404).send('יועץ לא נמצא');
    }
    
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
        return res.status(400).send('נא להגדיר תחילה את פרטי ה-Google OAuth');
    }

    // יצירת URL להתחברות עם ההרשאות הנדרשות
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',  // מבקש refresh token
        scope: [
            'https://www.googleapis.com/auth/calendar.readonly',   // קריאת יומנים
            'https://www.googleapis.com/auth/calendar.events',     // יצירת אירועים
            'https://www.googleapis.com/auth/userinfo.email'       // קריאת אימייל המשתמש
        ],
        prompt: 'consent',       // תמיד מבקש אישור (כדי לקבל refresh token)
        state: advisorId         // שומר את מזהה היועץ למעבר ל-callback
    });

    res.redirect(authUrl);
});

/**
 * GET /auth/callback
 * ------------------
 * מקבל את התגובה מ-Google אחרי ההתחברות
 * 
 * פרמטרים (בשורת הכתובת):
 * - code: קוד האימות מ-Google
 * - state: מזהה היועץ (שנשלח ב-/auth/start)
 * 
 * התהליך:
 * 1. מחליף את הקוד בטוקנים
 * 2. מביא את פרטי המשתמש (אימייל)
 * 3. שומר את הטוקנים והאימייל ביועץ
 * 4. מעביר את המשתמש חזרה לדף ההגדרות
 */
app.get('/auth/callback', async (req, res) => {
    const { code, state: advisorId } = req.query;
    
    // וידוא שהיועץ קיים
    if (!advisorId || !advisors[advisorId]) {
        return res.redirect('/admin.html?auth=error&message=invalid_advisor');
    }
    
    const oauth2Client = getOAuth2Client();

    try {
        // החלפת הקוד בטוקנים
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        
        // קבלת פרטי המשתמש (אימייל)
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        
        // שמירת הטוקנים והאימייל ביועץ
        advisors[advisorId].tokens = tokens;
        advisors[advisorId].email = userInfo.data.email;
        saveAdvisors(advisors);
        
        // חזרה לדף ההגדרות עם הודעת הצלחה
        res.redirect(`/setup/${advisorId}?auth=success`);
    } catch (error) {
        console.error('שגיאה באימות:', error);
        res.redirect(`/setup/${advisorId}?auth=error`);
    }
});

/**
 * GET /api/advisor/:id/calendars
 * ------------------------------
 * מחזיר את רשימת היומנים של יועץ מ-Google Calendar
 * 
 * פרמטרים:
 * - id: מזהה היועץ (בנתיב)
 * 
 * תגובה: מערך של יומנים מ-Google Calendar API
 */
app.get('/api/advisor/:id/calendars', async (req, res) => {
    const { id } = req.params;
    const advisor = advisors[id];
    
    // וידוא שהיועץ קיים ומחובר
    if (!advisor || !advisor.tokens) {
        return res.status(401).json({ error: 'לא מחובר ל-Google' });
    }

    const oauth2Client = getOAuth2Client(id);

    try {
        // קבלת רשימת היומנים מ-Google
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.calendarList.list();
        res.json(response.data.items);
    } catch (error) {
        console.error('שגיאה בטעינת יומנים:', error);
        res.status(500).json({ error: 'שגיאה בטעינת יומנים' });
    }
});

// ============================================================================
// נתיבי API - קביעת פגישות (Booking)
// ============================================================================

/**
 * GET /api/book/:advisorId/availability
 * -------------------------------------
 * מחזיר את הזמנים הפנויים של יועץ לקביעת פגישות
 * 
 * פרמטרים:
 * - advisorId: מזהה היועץ (בנתיב)
 * 
 * תגובה:
 * - advisor: פרטי היועץ (שם, משך פגישה)
 * - slots: מערך של זמנים פנויים
 * 
 * התהליך:
 * 1. בודק שהיועץ קיים ומוגדר
 * 2. שואל את Google Calendar API על זמנים תפוסים
 * 3. מחשב את הזמנים הפנויים לפי שעות העבודה
 */
app.get('/api/book/:advisorId/availability', async (req, res) => {
    const { advisorId } = req.params;
    const advisor = advisors[advisorId];
    
    // בדיקות תקינות
    if (!advisor) {
        return res.status(404).json({ error: 'יועץ לא נמצא' });
    }
    
    if (!advisor.tokens) {
        return res.status(400).json({ error: 'היועץ עדיין לא הגדיר את היומן שלו' });
    }

    if (!advisor.calendars || advisor.calendars.length === 0) {
        return res.status(400).json({ error: 'היועץ לא בחר יומנים לסנכרון' });
    }

    const oauth2Client = getOAuth2Client(advisorId);

    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // הגדרת טווח הזמן - 14 ימים קדימה
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 14);

        // שאילתת Free/Busy - מחזירה את הזמנים התפוסים
        const freeBusyResponse = await calendar.freebusy.query({
            requestBody: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                items: advisor.calendars.map(cal => ({ id: cal.id }))
            }
        });

        // איסוף כל הזמנים התפוסים מכל היומנים
        const allBusyTimes = [];
        for (const calId of Object.keys(freeBusyResponse.data.calendars)) {
            const busyTimes = freeBusyResponse.data.calendars[calId].busy || [];
            allBusyTimes.push(...busyTimes);
        }

        // חישוב הזמנים הפנויים
        const availableSlots = generateAvailableSlots(
            timeMin,
            timeMax,
            allBusyTimes,
            advisor.meetingDuration || 30,
            advisor.workingHours || { start: 9, end: 17 }
        );

        res.json({
            advisor: {
                name: advisor.name,
                meetingDuration: advisor.meetingDuration || 30
            },
            slots: availableSlots
        });
    } catch (error) {
        console.error('שגיאה בטעינת זמינות:', error);
        res.status(500).json({ error: 'שגיאה בטעינת זמינות' });
    }
});

/**
 * מחשב את הזמנים הפנויים לפגישות
 * -------------------------------
 * הפונקציה עוברת על כל הימים בטווח ומוצאת את הזמנים הפנויים
 * לפי שעות העבודה והזמנים התפוסים.
 * 
 * @param {Date} startDate - תאריך התחלה
 * @param {Date} endDate - תאריך סיום
 * @param {Array} busyTimes - מערך של זמנים תפוסים [{start, end}]
 * @param {number} duration - משך הפגישה בדקות
 * @param {Object} workingHours - שעות עבודה {start: 9, end: 17}
 * @returns {Array} מערך של זמנים פנויים
 */
function generateAvailableSlots(startDate, endDate, busyTimes, duration, workingHours) {
    const slots = [];
    const current = new Date(startDate);
    current.setHours(workingHours.start, 0, 0, 0);

    // אם עברנו את שעות העבודה היום - מתחילים מחר
    if (new Date() > current) {
        current.setDate(current.getDate() + 1);
        current.setHours(workingHours.start, 0, 0, 0);
    }

    // עוברים על כל הימים בטווח
    while (current < endDate) {
        // דילוג על שישי ושבת (ימים 5 ו-6)
        const day = current.getDay();
        if (day !== 5 && day !== 6) {
            // הגדרת תחילת וסוף יום העבודה
            const dayStart = new Date(current);
            dayStart.setHours(workingHours.start, 0, 0, 0);
            const dayEnd = new Date(current);
            dayEnd.setHours(workingHours.end, 0, 0, 0);

            let slotStart = new Date(dayStart);

            // עוברים על כל החלונות האפשריים ביום
            while (slotStart < dayEnd) {
                const slotEnd = new Date(slotStart);
                slotEnd.setMinutes(slotEnd.getMinutes() + duration);

                // בדיקה שהחלון בתוך שעות העבודה ובעתיד
                if (slotEnd <= dayEnd && slotStart > new Date()) {
                    // בדיקה שהחלון לא מתנגש עם זמן תפוס
                    const isAvailable = !busyTimes.some(busy => {
                        const busyStart = new Date(busy.start);
                        const busyEnd = new Date(busy.end);
                        // חפיפה: אם ההתחלה לפני הסוף והסוף אחרי ההתחלה
                        return (slotStart < busyEnd && slotEnd > busyStart);
                    });

                    if (isAvailable) {
                        slots.push({
                            start: slotStart.toISOString(),
                            end: slotEnd.toISOString(),
                            display: formatSlotDisplay(slotStart, slotEnd)
                        });
                    }
                }

                // מעבר לחלון הבא
                slotStart.setMinutes(slotStart.getMinutes() + duration);
            }
        }

        // מעבר ליום הבא
        current.setDate(current.getDate() + 1);
        current.setHours(workingHours.start, 0, 0, 0);
    }

    return slots;
}

/**
 * מפרמט את תצוגת הזמן לעברית
 * -------------------------
 * @param {Date} start - זמן התחלה
 * @param {Date} end - זמן סיום
 * @returns {string} מחרוזת בפורמט "יום שני, 15 בינואר 2024 | 10:00 - 10:30"
 */
function formatSlotDisplay(start, end) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = start.toLocaleDateString('he-IL', options);
    const startTime = start.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const endTime = end.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} | ${startTime} - ${endTime}`;
}

/**
 * POST /api/book/:advisorId
 * -------------------------
 * קובע פגישה חדשה עם יועץ
 * 
 * פרמטרים בנתיב:
 * - advisorId: מזהה היועץ
 * 
 * פרמטרים בגוף הבקשה:
 * - slot: הזמן שנבחר {start, end}
 * - name: שם הלקוח
 * - email: אימייל הלקוח
 * - phone: טלפון (אופציונלי)
 * - notes: הערות (אופציונלי)
 * 
 * התהליך:
 * 1. יוצר אירוע ביומן Google של היועץ
 * 2. שולח התראה ל-Webhook (אם מוגדר)
 * 3. מחזיר קישור לאירוע
 */
app.post('/api/book/:advisorId', async (req, res) => {
    const { advisorId } = req.params;
    const advisor = advisors[advisorId];
    
    // וידוא שהיועץ קיים ומחובר
    if (!advisor || !advisor.tokens) {
        return res.status(404).json({ error: 'יועץ לא נמצא או לא מחובר' });
    }

    const oauth2Client = getOAuth2Client(advisorId);
    const { slot, name, email, phone, notes } = req.body;

    // וידוא שדות חובה
    if (!slot || !name || !email) {
        return res.status(400).json({ error: 'נא למלא את כל השדות הנדרשים' });
    }

    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // הכנת אובייקט האירוע
        const event = {
            summary: `פגישה עם ${name}`,
            description: `
שם: ${name}
אימייל: ${email}
טלפון: ${phone || 'לא צוין'}
הערות: ${notes || 'אין'}
            `.trim(),
            start: {
                dateTime: slot.start,
                timeZone: 'Asia/Jerusalem'
            },
            end: {
                dateTime: slot.end,
                timeZone: 'Asia/Jerusalem'
            },
            attendees: [{ email }]  // הוספת הלקוח כמשתתף
        };

        // יצירת האירוע ביומן הראשון שנבחר
        const targetCalendar = advisor.calendars[0]?.id || 'primary';
        const createdEvent = await calendar.events.insert({
            calendarId: targetCalendar,
            requestBody: event,
            sendUpdates: 'all'  // שליחת הזמנה במייל לכל המשתתפים
        });

        // שליחת התראה ל-Webhook
        if (config.webhookUrl) {
            try {
                await axios.post(config.webhookUrl, {
                    event: 'booking_created',
                    data: {
                        advisor: {
                            id: advisorId,
                            name: advisor.name,
                            email: advisor.email
                        },
                        eventId: createdEvent.data.id,
                        eventLink: createdEvent.data.htmlLink,
                        slot,
                        attendee: { name, email, phone, notes },
                        createdAt: new Date().toISOString()
                    }
                });
            } catch (webhookError) {
                // שגיאה ב-Webhook לא עוצרת את התהליך
                console.error('שגיאה בשליחה ל-Webhook:', webhookError.message);
            }
        }

        res.json({
            success: true,
            message: 'הפגישה נקבעה בהצלחה!',
            eventLink: createdEvent.data.htmlLink
        });

    } catch (error) {
        console.error('שגיאה בקביעת פגישה:', error);
        res.status(500).json({ error: 'שגיאה בקביעת הפגישה' });
    }
});

// ============================================================================
// נתיבי דפים
// ============================================================================

/**
 * GET /admin
 * ----------
 * מציג את דף ניהול המערכת
 */
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

/**
 * GET /setup/:advisorId
 * ---------------------
 * מציג את דף הגדרת היועץ
 * היועץ משתמש בדף זה כדי לחבר את היומן שלו
 */
app.get('/setup/:advisorId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

/**
 * GET /book/:advisorId
 * --------------------
 * מציג את דף קביעת הפגישות
 * לקוחות משתמשים בדף זה כדי לקבוע פגישה עם היועץ
 */
app.get('/book/:advisorId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

/**
 * GET /
 * -----
 * דף הבית - מפנה לדף הניהול
 */
app.get('/', (req, res) => {
    res.redirect('/admin.html');
});

// ============================================================================
// הפעלת השרת
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║   🗓️  Calendar Sync & Booking App - Multi Advisor                 ║
║                                                                    ║
║   השרת פועל בכתובת: http://localhost:${PORT}                        ║
║                                                                    ║
║   📌 דף ניהול:      http://localhost:${PORT}/admin.html              ║
║   📌 דף הגדרת יועץ: http://localhost:${PORT}/setup/:id               ║
║   📌 דף קביעת פגישה: http://localhost:${PORT}/book/:id               ║
║                                                                    ║
║   📖 תיעוד מלא בקובץ server.js                                     ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
    `);
});

// ============================================================================
// סוף הקובץ
// ============================================================================
