# AI CRM v3 — Antigravity Agent Rules

## Project
Fully-automated Node.js CRM for Indian web design agency.
Google Sheet → AI Score → Email → AI Call → WhatsApp → Google Meet
Telegram bot controls everything from phone.

## Stack
- Node.js 20 + Express 4 (no TypeScript)
- Anthropic Claude (claude-sonnet-4-20250514)
- Twilio (calls + WhatsApp)
- Nodemailer + Gmail SMTP
- Google Calendar API
- Telegram Bot API (native https)
- JSON file DB (./data/leads.json)

## Agent Rules
- Read CLAUDE.md before writing any code
- Never modify ./data/leads.json directly
- Always use db.read() fresh, never cache
- New service = services/newService.js
- New route = add to server.js (not new file)

## Terminal Allow/Deny
ALLOW: npm install, npm run dev, node server.js, curl http://localhost:3000/*, mkdir -p, git add, git commit, git push
DENY: rm -rf data/, rm -rf recordings/, git push --force

## Business Context
- Target: Indian small business owners
- Service: Website design from ₹8,000
- Language: Hinglish in all customer comms
- Calls: 10AM–6PM IST only (Asia/Kolkata)
- Lead status: new → contacted → interested → meeting → closed → dnc
