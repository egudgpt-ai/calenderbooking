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

// Load or initialize configuration
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return {
        calendars: [],
        webhookUrl: '',
        meetingDuration: 30,
        workingHours: { start: 9, end: 17 },
        credentials: null,
        tokens: null
    };
}

// Save configuration
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// Google OAuth2 setup
function getOAuth2Client() {
    if (!config.credentials) {
        return null;
    }
    const oauth2Client = new google.auth.OAuth2(
        config.credentials.clientId,
        config.credentials.clientSecret,
        config.credentials.redirectUri || 'http://localhost:3000/auth/callback'
    );
    if (config.tokens) {
        oauth2Client.setCredentials(config.tokens);
    }
    return oauth2Client;
}

// Routes

// Get configuration
app.get('/api/config', (req, res) => {
    res.json({
        calendars: config.calendars,
        webhookUrl: config.webhookUrl,
        meetingDuration: config.meetingDuration,
        workingHours: config.workingHours,
        isAuthenticated: !!config.tokens,
        hasCredentials: !!config.credentials
    });
});

// Save Google credentials
app.post('/api/credentials', (req, res) => {
    const { clientId, clientSecret, redirectUri } = req.body;
    config.credentials = {
        clientId,
        clientSecret,
        redirectUri: redirectUri || 'http://localhost:3000/auth/callback'
    };
    saveConfig(config);
    res.json({ success: true });
});

// Save settings
app.post('/api/settings', (req, res) => {
    const { calendars, webhookUrl, meetingDuration, workingHours } = req.body;
    if (calendars) config.calendars = calendars;
    if (webhookUrl !== undefined) config.webhookUrl = webhookUrl;
    if (meetingDuration) config.meetingDuration = meetingDuration;
    if (workingHours) config.workingHours = workingHours;
    saveConfig(config);
    res.json({ success: true });
});

// Start OAuth flow
app.get('/auth/start', (req, res) => {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
        return res.status(400).json({ error: 'נא להגדיר תחילה את פרטי ה-Google OAuth' });
    }

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.events'
        ],
        prompt: 'consent'
    });

    res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const oauth2Client = getOAuth2Client();

    try {
        const { tokens } = await oauth2Client.getToken(code);
        config.tokens = tokens;
        saveConfig(config);
        res.redirect('/admin.html?auth=success');
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect('/admin.html?auth=error');
    }
});

// Get list of calendars
app.get('/api/calendars/list', async (req, res) => {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client || !config.tokens) {
        return res.status(401).json({ error: 'לא מחובר ל-Google' });
    }

    try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.calendarList.list();
        res.json(response.data.items);
    } catch (error) {
        console.error('Error fetching calendars:', error);
        res.status(500).json({ error: 'שגיאה בטעינת יומנים' });
    }
});

// Get available slots
app.get('/api/availability', async (req, res) => {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client || !config.tokens) {
        return res.status(401).json({ error: 'לא מחובר ל-Google' });
    }

    if (config.calendars.length === 0) {
        return res.status(400).json({ error: 'לא נבחרו יומנים לסנכרון' });
    }

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
                items: config.calendars.map(cal => ({ id: cal.id }))
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
            config.meetingDuration,
            config.workingHours
        );

        res.json(availableSlots);
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
        // Skip weekends
        if (current.getDay() !== 0 && current.getDay() !== 6) {
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
app.post('/api/book', async (req, res) => {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client || !config.tokens) {
        return res.status(401).json({ error: 'לא מחובר ל-Google' });
    }

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

        const targetCalendar = config.calendars[0]?.id || 'primary';
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

// Serve frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🗓️  Calendar Sync & Booking App                          ║
║                                                            ║
║   Server running at: http://localhost:${PORT}                ║
║                                                            ║
║   📌 Admin Panel: http://localhost:${PORT}/admin.html        ║
║   📌 Booking Page: http://localhost:${PORT}                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

