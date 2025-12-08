const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuration file path
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADVISORS_FILE = path.join(__dirname, 'advisors.json');

// Load or initialize main configuration (for webhook URL and Google credentials)
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return {
        webhookUrl: '',
        credentials: null
    };
}

// Save main configuration
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Load advisors data
function loadAdvisors() {
    try {
        if (fs.existsSync(ADVISORS_FILE)) {
            return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading advisors:', error);
    }
    return {};
}

// Save advisors data
function saveAdvisors(advisors) {
    fs.writeFileSync(ADVISORS_FILE, JSON.stringify(advisors, null, 2));
}

let config = loadConfig();
let advisors = loadAdvisors();

// Google OAuth2 setup for a specific advisor
function getOAuth2Client(advisorId = null) {
    if (!config.credentials) {
        return null;
    }
    const oauth2Client = new google.auth.OAuth2(
        config.credentials.clientId,
        config.credentials.clientSecret,
        config.credentials.redirectUri || `${getBaseUrl()}/auth/callback`
    );
    
    if (advisorId && advisors[advisorId] && advisors[advisorId].tokens) {
        oauth2Client.setCredentials(advisors[advisorId].tokens);
    }
    
    return oauth2Client;
}

// Get base URL
function getBaseUrl() {
    return process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || 'http://localhost:3000';
}

// ==================== ADMIN ROUTES ====================

// Get main configuration
app.get('/api/config', (req, res) => {
    res.json({
        webhookUrl: config.webhookUrl,
        hasCredentials: !!config.credentials,
        baseUrl: getBaseUrl()
    });
});

// Save Google credentials
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

// Save webhook URL
app.post('/api/webhook', (req, res) => {
    const { webhookUrl } = req.body;
    config.webhookUrl = webhookUrl;
    saveConfig(config);
    res.json({ success: true });
});

// Get all advisors
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

// Create new advisor
app.post('/api/advisors', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'נא להזין שם' });
    }
    
    // Create unique ID from name
    const id = name.toLowerCase()
        .replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'advisor-' + Date.now();
    
    if (advisors[id]) {
        return res.status(400).json({ error: 'יועץ עם שם זה כבר קיים' });
    }
    
    advisors[id] = {
        name,
        email: null,
        tokens: null,
        calendars: [],
        meetingDuration: 30,
        workingHours: { start: 9, end: 17 }
    };
    
    saveAdvisors(advisors);
    
    res.json({ 
        success: true, 
        id,
        setupLink: `${getBaseUrl()}/setup/${id}`
    });
});

// Delete advisor
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

// ==================== ADVISOR SETUP ROUTES ====================

// Get advisor info
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

// Update advisor settings
app.post('/api/advisor/:id/settings', (req, res) => {
    const { id } = req.params;
    const { calendars, meetingDuration, workingHours } = req.body;
    
    if (!advisors[id]) {
        return res.status(404).json({ error: 'יועץ לא נמצא' });
    }
    
    if (calendars) advisors[id].calendars = calendars;
    if (meetingDuration) advisors[id].meetingDuration = meetingDuration;
    if (workingHours) advisors[id].workingHours = workingHours;
    
    saveAdvisors(advisors);
    res.json({ success: true });
});

// Start OAuth flow for advisor
app.get('/auth/start/:advisorId', (req, res) => {
    const { advisorId } = req.params;
    
    if (!advisors[advisorId]) {
        return res.status(404).send('יועץ לא נמצא');
    }
    
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
        return res.status(400).send('נא להגדיר תחילה את פרטי ה-Google OAuth');
    }

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent',
        state: advisorId
    });

    res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
    const { code, state: advisorId } = req.query;
    
    if (!advisorId || !advisors[advisorId]) {
        return res.redirect('/admin.html?auth=error&message=invalid_advisor');
    }
    
    const oauth2Client = getOAuth2Client();

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        
        // Get user email
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        
        advisors[advisorId].tokens = tokens;
        advisors[advisorId].email = userInfo.data.email;
        saveAdvisors(advisors);
        
        res.redirect(`/setup/${advisorId}?auth=success`);
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect(`/setup/${advisorId}?auth=error`);
    }
});

// Get calendars list for advisor
app.get('/api/advisor/:id/calendars', async (req, res) => {
    const { id } = req.params;
    const advisor = advisors[id];
    
    if (!advisor || !advisor.tokens) {
        return res.status(401).json({ error: 'לא מחובר ל-Google' });
    }

    const oauth2Client = getOAuth2Client(id);

    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.calendarList.list();
        res.json(response.data.items);
    } catch (error) {
        console.error('Error fetching calendars:', error);
        res.status(500).json({ error: 'שגיאה בטעינת יומנים' });
    }
});

// ==================== BOOKING ROUTES ====================

// Get availability for booking
app.get('/api/book/:advisorId/availability', async (req, res) => {
    const { advisorId } = req.params;
    const advisor = advisors[advisorId];
    
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

        // Get next 14 days
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 14);

        // Query free/busy for all selected calendars
        const freeBusyResponse = await calendar.freebusy.query({
            requestBody: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                items: advisor.calendars.map(cal => ({ id: cal.id }))
            }
        });

        // Collect all busy times
        const allBusyTimes = [];
        for (const calId of Object.keys(freeBusyResponse.data.calendars)) {
            const busyTimes = freeBusyResponse.data.calendars[calId].busy || [];
            allBusyTimes.push(...busyTimes);
        }

        // Generate available slots
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
        console.error('Error fetching availability:', error);
        res.status(500).json({ error: 'שגיאה בטעינת זמינות' });
    }
});

// Generate available time slots
function generateAvailableSlots(startDate, endDate, busyTimes, duration, workingHours) {
    const slots = [];
    const current = new Date(startDate);
    current.setHours(workingHours.start, 0, 0, 0);

    // If we're past working hours today, start tomorrow
    if (new Date() > current) {
        current.setDate(current.getDate() + 1);
        current.setHours(workingHours.start, 0, 0, 0);
    }

    while (current < endDate) {
        // Skip weekends (Friday and Saturday in Israel)
        const day = current.getDay();
        if (day !== 5 && day !== 6) { // Skip Friday (5) and Saturday (6)
            const dayStart = new Date(current);
            dayStart.setHours(workingHours.start, 0, 0, 0);
            const dayEnd = new Date(current);
            dayEnd.setHours(workingHours.end, 0, 0, 0);

            let slotStart = new Date(dayStart);

            while (slotStart < dayEnd) {
                const slotEnd = new Date(slotStart);
                slotEnd.setMinutes(slotEnd.getMinutes() + duration);

                if (slotEnd <= dayEnd && slotStart > new Date()) {
                    // Check if slot conflicts with any busy time
                    const isAvailable = !busyTimes.some(busy => {
                        const busyStart = new Date(busy.start);
                        const busyEnd = new Date(busy.end);
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

                slotStart.setMinutes(slotStart.getMinutes() + duration);
            }
        }

        current.setDate(current.getDate() + 1);
        current.setHours(workingHours.start, 0, 0, 0);
    }

    return slots;
}

function formatSlotDisplay(start, end) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = start.toLocaleDateString('he-IL', options);
    const startTime = start.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const endTime = end.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} | ${startTime} - ${endTime}`;
}

// Book a meeting
app.post('/api/book/:advisorId', async (req, res) => {
    const { advisorId } = req.params;
    const advisor = advisors[advisorId];
    
    if (!advisor || !advisor.tokens) {
        return res.status(404).json({ error: 'יועץ לא נמצא או לא מחובר' });
    }

    const oauth2Client = getOAuth2Client(advisorId);
    const { slot, name, email, phone, notes } = req.body;

    if (!slot || !name || !email) {
        return res.status(400).json({ error: 'נא למלא את כל השדות הנדרשים' });
    }

    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Create event in the first calendar
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
            attendees: [{ email }]
        };

        const targetCalendar = advisor.calendars[0]?.id || 'primary';
        const createdEvent = await calendar.events.insert({
            calendarId: targetCalendar,
            requestBody: event,
            sendUpdates: 'all'
        });

        // Send to webhook if configured
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
                console.error('Webhook error:', webhookError.message);
            }
        }

        res.json({
            success: true,
            message: 'הפגישה נקבעה בהצלחה!',
            eventLink: createdEvent.data.htmlLink
        });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ error: 'שגיאה בקביעת הפגישה' });
    }
});

// ==================== PAGE ROUTES ====================

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve advisor setup page
app.get('/setup/:advisorId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// Serve booking page
app.get('/book/:advisorId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Default route
app.get('/', (req, res) => {
    res.redirect('/admin.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🗓️  Calendar Sync & Booking App - Multi Advisor         ║
║                                                            ║
║   Server running at: http://localhost:${PORT}                ║
║                                                            ║
║   📌 Admin Panel: http://localhost:${PORT}/admin.html        ║
║   📌 Advisor Setup: http://localhost:${PORT}/setup/:id       ║
║   📌 Booking Page: http://localhost:${PORT}/book/:id         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
