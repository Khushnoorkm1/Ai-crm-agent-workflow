# AI CRM v3 — Project Intelligence File
# Works with: Cursor, Antigravity, VSCode Copilot, Claude, ChatGPT

## Project Summary
Fully-automated Node.js CRM that reads leads from Google Sheet and automatically: scores with AI, sends Hinglish emails, makes real 2-way AI phone calls, saves recordings, sends WhatsApp, and schedules Google Meet — zero manual work.

## Tech Stack
```
Runtime:   Node.js 20+ (LTS)
Framework: Express 4.19
AI:        Anthropic Claude (claude-sonnet-4-20250514)
Calls:     Twilio Programmable Voice + Media Streams (WebSocket)
Email:     Nodemailer + Gmail SMTP
WhatsApp:  Twilio WhatsApp Sandbox API
Meetings:  Google Calendar API v3 (OAuth2)
Bot:       Telegram Bot API (native https — no library)
Database:  JSON file (./data/leads.json) — no external DB
Hosting:   Railway.app recommended
```

## Folder Structure
```
ai-crm-v3/
├── server.js                 ← Main Express + all routes + WebSocket
├── package.json
├── .env                      ← API keys (NEVER commit)
├── CLAUDE.md                 ← THIS FILE
├── types.js                  ← JSDoc types for IntelliSense
├── services/
│   ├── autoOrchestrator.js   ← BRAIN: score→email→call→WA→meeting
│   ├── guardService.js       ← Call hours (10AM-6PM IST), DNC, duplicate
│   ├── retryService.js       ← Exponential backoff retry
│   ├── dailyReportService.js ← 8AM IST daily email summary
│   ├── telegramBot.js        ← /start /stats /leads /run /call /email etc.
│   ├── telegramBotFull.js    ← Full telegramBot (use this, rename to telegramBot.js)
│   ├── chatbotService.js     ← Website chatbot lead capture
│   ├── callService.js        ← Twilio + Claude 2-way conversation + recording
│   ├── whatsappService.js    ← WhatsApp send + incoming reply handler
│   ├── emailService.js       ← AI Hinglish emails (cold/followup/meeting_confirm)
│   ├── meetingService.js     ← Google Calendar auto Meet + SMS + email confirm
│   ├── leadScoringService.js ← AI score 0-100 (rule-based + Claude)
│   ├── sheetUpdateService.js ← Google Sheet 2-way sync
│   └── followUpScheduler.js  ← Day 3/7/14 automatic follow-ups
├── public/
│   └── dashboard.html        ← Live dashboard (Chart.js + recordings player)
├── data/
│   ├── leads.json            ← Main DB
│   └── dnc.json              ← Do Not Call list
└── recordings/               ← MP3 call recordings
```

## Environment Variables
```bash
# Server
PORT=3000
BASE_URL=https://your-url.com
BASE_DOMAIN=your-url.com

# Agency
AGENCY_NAME=WebPro Agency
AGENCY_PHONE=+91-9876543210
AGENCY_WEBSITE=https://yourwebsite.com

# AI
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=you@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx  # Gmail App Password
REPORT_EMAIL=you@gmail.com

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Google Calendar
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_REFRESH_TOKEN=1//xxxxx

# Google Sheet
GOOGLE_SHEET_WEBAPP_URL=https://script.google.com/macros/s/XXXXX/exec

# Telegram
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=987654321
```

## Lead Object Schema
```javascript
{
  id, name, business,
  phone,    // 10 digits NO +91
  email, city, notes, source,
  status,   // new|contacted|interested|meeting|closed|dnc
  score,    // 0-100
  priority, // HIGH|MEDIUM|LOW
  rowIndex, // Google Sheet row (1-based)
  emailSent, callOutcome, callTranscript,
  callDuration, recordingFile,
  whatsappSent, meetLink, meetingTime,
  lastContact, createdAt
}
```

## Lead Status Flow
`new → contacted → interested → meeting → closed | dnc`

## All API Routes
```
POST /api/auto/process-lead          ← Google Sheet trigger
GET  /api/dashboard/stats            ← Live stats
GET  /api/dashboard/leads            ← All leads by score
GET  /api/dashboard/recordings       ← Recordings list
GET  /api/dashboard/failures         ← Failed operations
POST /api/dashboard/retry-failures   ← Retry all
GET  /api/guards/dnc                 ← DNC list
POST /api/guards/dnc/add             ← Block lead
POST /api/guards/dnc/remove          ← Unblock
POST /api/leads/campaigns/email/start
POST /api/leads/campaigns/call/start
POST /api/calling/speech/:id         ← Twilio webhook
POST /api/calling/recording-done/:id ← Twilio webhook
POST /api/calling/transcription/:id  ← Twilio webhook
POST /api/whatsapp/incoming          ← Twilio webhook
POST /api/telegram/webhook           ← Telegram updates
GET  /api/telegram/setup             ← Register webhook (once)
POST /api/chatbot/greet
POST /api/chatbot/message
POST /api/report/send-now
GET  /auth/google                    ← OAuth setup
GET  /health
GET  /                               → /dashboard.html
```

## Critical Coding Rules
1. DB: Always `db.read()` fresh — never cache
2. Phone: Store as 10 digits, add +91 only for Twilio calls
3. Language: All customer content = Hinglish (Hindi + English)
4. Calls: Only 10AM-6PM IST (guardService enforces this)
5. External APIs: Always use `withRetry()` from retryService
6. New routes: Add to server.js, not separate files
7. DNC: "not_interested" outcome auto-adds to DNC
8. Score < 30: Email only, skip call

## Google Sheet Columns (A-P)
```
A:Name  B:Business  C:Phone  D:Email  E:City  F:Notes
G:Status  H:EmailSent  I:CallStatus  J:CallResponse
K:CallRecording  L:WhatsAppSent  M:MeetingLink
N:MeetingTime  O:LeadScore  P:LastUpdated
```
Columns G-P are filled automatically by CRM.

## Telegram Commands
`/start /stats /leads /run /email /call /report /pipeline /dnc /dnc_list /failures /retry /recordings /help`

## Debugging Quick Reference
| Problem | Check |
|---------|-------|
| Server won't start | .env complete? All service files exist in services/? |
| Email failing | Gmail App Password correct? 2FA enabled? |
| Calls failing | Twilio India enabled? BASE_URL is public not localhost? |
| Telegram silent | /api/telegram/setup hit? BOT_TOKEN correct? |
| Sheet not updating | GOOGLE_SHEET_WEBAPP_URL set? Web App deployed? |
| Meeting not booking | Refresh token valid? Visit /auth/google to refresh |

## IMPORTANT: telegramBot.js
File `services/telegramBot.js` is a stub. The full implementation is in `services/telegramBotFull.js`.
To use full bot: copy telegramBotFull.js content into telegramBot.js.
