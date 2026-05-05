# GitHub Copilot Instructions — AI CRM v3

## Project in one line
Node.js CRM that reads leads from Google Sheet and automatically emails, calls (AI conversation), WhatsApps, and books Google Meet — all triggered by adding a row in a spreadsheet.

## Critical patterns

### 1. Database — always read fresh
```javascript
const data = app.locals.db.read(); // or db.read()
data.leads.push(newItem);
app.locals.db.write(data);
```

### 2. Phone normalization
```javascript
const phone = String(raw).replace(/\D/g, "").slice(-10); // 10 digits only
const twilioTo = "+91" + phone; // Only for Twilio
```

### 3. IST time check
```javascript
const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
const hour = ist.getUTCHours(); // 10-18 = calling hours
```

### 4. Retry wrapper for all external calls
```javascript
const { withRetry } = require("./services/retryService");
await withRetry(() => externalApi(), { maxRetries: 3, label: "description" });
```

### 5. Guard check before outreach
```javascript
const { runAllGuards } = require("./services/guardService");
const guard = await runAllGuards(lead, db);
if (guard.blocked) return;
```

### 6. Telegram notification
```javascript
const { notify } = require("./services/telegramBot");
await notify(`Event: ${lead.name}`);
```

## Lead status flow
`new` → `contacted` → `interested` → `meeting` → `closed` | `dnc`

## Language rule
All customer content (emails, call scripts, WhatsApp) = Hinglish (Hindi + English)

## Never suggest
- TypeScript migration
- External database (MongoDB etc)
- Caching db.read() results
- Calling outside 10AM-6PM IST
- Storing phone with +91 in DB
- Skipping DNC check
