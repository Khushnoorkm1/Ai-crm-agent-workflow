# AI CRM v3 — Full Auto Agent Workflow

> Google Sheet mein lead daalo → AI automatically email, call, WhatsApp, aur Google Meet karta hai

## Quick Start

```bash
npm install
cp .env.example .env   # Fill in your API keys
node server.js
# Open: http://localhost:3000/dashboard.html
```

## What it does

1. **Google Sheet → Lead** — Sheet mein lead add karo
2. **AI Score (0-100)** — Claude lead ko score karta hai (business type, city, notes)
3. **Hinglish Email** — Personalized email Claude se generate hokar Gmail se jaati hai
4. **AI Phone Call** — Twilio real 2-way conversation, recording save hoti hai
5. **WhatsApp** — Call ke baad automatic WA message + reply detect
6. **Google Meet** — Interested lead ke liye auto-schedule + SMS + email confirm
7. **Telegram Bot** — Phone se `/run`, `/stats`, `/leads` — poora CRM control
8. **Website Chatbot** — Visitor website pe aaye → lead capture → CRM
9. **Daily Report** — 8AM IST pe email summary
10. **Follow-up Scheduler** — Day 3/7/14 automatic retry sequences

## Tech Stack

- Node.js 20 + Express 4
- Anthropic Claude (`claude-sonnet-4-20250514`)
- Twilio (Calls + WhatsApp + Recordings)
- Nodemailer + Gmail SMTP
- Google Calendar API (auto Meet)
- Telegram Bot API (phone control)
- JSON file database (no external DB needed)

## AI Context Files (for AI coding tools)

| File | Tool |
|------|------|
| `CLAUDE.md` | Claude, ChatGPT, all AI |
| `.cursorrules` | Cursor IDE |
| `.antigravity/rules.md` | Antigravity IDE |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` | VSCode |
| `types.js` | IntelliSense / JSDoc |
| `AI_PROMPTS.md` | Ready-made AI prompts |

## Full Documentation

See **[CLAUDE.md](./CLAUDE.md)** — complete architecture, all APIs, service contracts, database schema, debugging guide.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
ANTHROPIC_API_KEY=       # console.anthropic.com
SMTP_EMAIL=              # your Gmail
SMTP_PASSWORD=           # Gmail App Password
TWILIO_ACCOUNT_SID=      # twilio.com
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TELEGRAM_BOT_TOKEN=      # @BotFather
TELEGRAM_CHAT_ID=        # @userinfobot
GOOGLE_CLIENT_ID=        # console.cloud.google.com
GOOGLE_REFRESH_TOKEN=
BASE_URL=                # ngrok or Railway URL
```

## Services

| File | Purpose |
|------|---------|
| `services/autoOrchestrator.js` | Brain — full automation flow |
| `services/guardService.js` | Call hours, DNC, duplicate check |
| `services/callService.js` | Twilio AI conversational calls |
| `services/emailService.js` | AI Hinglish email generation |
| `services/whatsappService.js` | WhatsApp send + reply handler |
| `services/meetingService.js` | Google Meet auto-schedule |
| `services/telegramBot.js` | Telegram bot control panel |
| `services/chatbotService.js` | Website chatbot lead capture |
| `services/leadScoringService.js` | AI scoring 0-100 |
| `services/retryService.js` | Exponential backoff retry |
| `services/followUpScheduler.js` | Day 3/7/14 follow-ups |
| `services/dailyReportService.js` | 8AM daily email report |
| `services/sheetUpdateService.js` | Google Sheet 2-way sync |

## Hosting

Recommended: **Railway.app** (`$5/month`) — WebSocket support, permanent URL, auto-deploy from GitHub.

## License

MIT
