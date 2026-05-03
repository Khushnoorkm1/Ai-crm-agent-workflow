// ============================================================
// server.js  — FINAL (all 7 fixes integrated)
// ✓ FIX 1: Call hours enforced in guardService
// ✓ FIX 2: Duplicate check in guardService
// ✓ FIX 3: DNC routes added
// ✓ FIX 4: Live dashboard data
// ✓ FIX 5: Recordings served from /recordings static folder
// ✓ FIX 6: Retry logic via retryService
// ✓ FIX 7: Daily report scheduled on startup
// ============================================================

require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const bodyParser = require("body-parser");
const fs         = require("fs");
const http       = require("http");
const WebSocket  = require("ws");
const path       = require("path");

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ── DB ────────────────────────────────────────────────────────
if (!fs.existsSync("./data"))       fs.mkdirSync("./data");
if (!fs.existsSync("./recordings")) fs.mkdirSync("./recordings");
if (!fs.existsSync("./public"))     fs.mkdirSync("./public");

const DB_FILE = "./data/leads.json";
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    leads:[], calls:[], emails:[], logs:{}, failures:[], recordings:[], meetings:[]
  }));
}

app.locals.db = {
  read()   { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); },
  write(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); },
};

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/recordings", express.static("./recordings"));
app.use(express.static("./public"));

// ── WebSocket — Twilio Media Streams ─────────────────────────
const { handleMediaStream, handleLeadSpeech, callSessions } = require("./services/callService");
wss.on("connection", (ws, req) => {
  const sessionId = req.url.split("/stream/")[1];
  if (sessionId) handleMediaStream(ws, sessionId);
});

// ── Auto Process Lead (Google Sheet triggers this) ────────────
app.post("/api/auto/process-lead", async (req, res) => {
  const lead = req.body;
  const db   = app.locals.db;
  const { mergeOrReject } = require("./services/guardService");
  const dupResult = mergeOrReject(lead, db);
  if (dupResult.action === "reject") {
    return res.json({ success: false, status: "Rejected", reason: dupResult.reason });
  }
  const data = db.read();
  const exists = data.leads.find(l => String(l.phone||"").slice(-10) === String(lead.phone||"").slice(-10));
  if (!exists) {
    data.leads.push({ ...lead, status: "new", createdAt: new Date().toISOString() });
    db.write(data);
  }
  const { generateLeadScore } = require("./services/leadScoringService");
  const score = await generateLeadScore(lead).catch(() => ({ total: 50, priority: "MEDIUM", tags: [] }));
  const d = db.read();
  const l = d.leads.find(x => String(x.phone||"").slice(-10) === String(lead.phone||"").slice(-10));
  if (l) { l.score = score.total; l.priority = score.priority; l.scoreTags = score.tags; }
  db.write(d);
  const { processLeadAutomatically } = require("./services/autoOrchestrator");
  setImmediate(() => processLeadAutomatically({ ...lead, ...l }, db));
  res.json({ success: true, status: "Queued", leadScore: score.total, priority: score.priority });
});

// ── DNC Routes ────────────────────────────────────────────────
const { addToDNC, getDNCList, removeFromDNC } = require("./services/guardService");
app.get("/api/guards/dnc", (req, res) => res.json(getDNCList()));
app.post("/api/guards/dnc/add", (req, res) => {
  const { name, phone, email, reason } = req.body;
  addToDNC({ name, phone, email }, reason || "Manually added");
  const data = app.locals.db.read();
  const lead = data.leads.find(l => String(l.phone||"").slice(-10) === String(phone||"").slice(-10));
  if (lead) { lead.status = "dnc"; }
  app.locals.db.write(data);
  res.json({ success: true });
});
app.post("/api/guards/dnc/remove", (req, res) => { removeFromDNC(req.body.phone); res.json({ success: true }); });

// ── Dashboard Stats (live data) ───────────────────────────────
app.get("/api/dashboard/stats", (req, res) => {
  const data  = app.locals.db.read();
  const leads = data.leads || [];
  const now   = new Date();
  const weekCalls = Array(7).fill(0);
  (data.calls || []).forEach(c => {
    if (!c.time) return;
    const diff = Math.floor((now - new Date(c.time)) / 86400000);
    if (diff >= 0 && diff < 7) weekCalls[6 - diff]++;
  });
  const byStatus = leads.reduce((acc, l) => { acc[l.status||"new"] = (acc[l.status||"new"]||0)+1; return acc; }, {});
  const calls    = (data.calls||[]).map(c=>({...c,type:"call"}));
  const emails   = (data.emails||[]).map(e=>({...e,type:"email"}));
  const waMsgs   = leads.filter(l=>l.whatsappSent).map(l=>({leadName:l.name,type:"whatsapp",time:l.whatsappSent}));
  const meetings = (data.meetings||[]).map(m=>({...m,type:"meeting"}));
  const recentActivity = [...calls,...emails,...waMsgs,...meetings]
    .sort((a,b)=>new Date(b.time||b.sentAt||0)-new Date(a.time||a.sentAt||0)).slice(0,20);
  res.json({
    total: leads.length, byStatus, weekCalls,
    emailsSent: (data.emails||[]).length, callsMade: (data.calls||[]).length,
    meetings: leads.filter(l=>l.status==="meeting").length,
    interested: leads.filter(l=>l.status==="interested").length,
    whatsAppSent: leads.filter(l=>l.whatsappSent).length,
    recordings: (data.recordings||[]).length, failures: (data.failures||[]).length,
    conversion: leads.length ? Math.round((leads.filter(l=>l.status==="meeting").length/leads.length)*100) : 0,
    recentActivity,
  });
});
app.get("/api/dashboard/leads", (req, res) => {
  const data = app.locals.db.read();
  const { rankLeads } = require("./services/leadScoringService");
  res.json(rankLeads(data.leads||[]));
});
app.get("/api/dashboard/recordings", (req, res) => {
  const data = app.locals.db.read();
  const recs = (data.recordings||[]).map(r=>({
    ...r, transcription:(data.transcripts||{})[r.sessionId]?.text||null,
    outcome:(data.transcripts||{})[r.sessionId]?.outcome||null,
  }));
  res.json(recs.reverse());
});
app.get("/api/dashboard/followups", (req, res) => {
  const { getPendingFollowUps } = require("./services/followUpScheduler");
  res.json(getPendingFollowUps(app.locals.db));
});
app.get("/api/dashboard/failures", (req, res) => {
  const { getFailures } = require("./services/retryService");
  res.json(getFailures(app.locals.db));
});
app.post("/api/dashboard/retry-failures", async (req, res) => {
  const { retryAllFailures } = require("./services/retryService");
  res.json({ success: true });
  setImmediate(() => retryAllFailures(app.locals.db));
});

// ── Twilio Webhooks ───────────────────────────────────────────
app.post("/api/calling/speech/:sessionId", async (req, res) => {
  await handleLeadSpeech(req.params.sessionId, req.body.SpeechResult);
  res.type("text/xml").send(`<?xml version="1.0"?><Response><Pause length="1"/></Response>`);
});
app.post("/api/calling/recording-done/:sessionId", async (req, res) => {
  const { RecordingUrl, RecordingSid } = req.body;
  const { saveRecording } = require("./services/callService");
  if (RecordingUrl) await saveRecording(RecordingUrl, RecordingSid, req.params.sessionId, app.locals.db);
  res.type("text/xml").send(`<?xml version="1.0"?><Response><Hangup/></Response>`);
});
app.post("/api/calling/transcription/:sessionId", (req, res) => {
  const { TranscriptionText } = req.body;
  if (TranscriptionText) {
    const data = app.locals.db.read();
    if (!data.transcripts) data.transcripts = {};
    data.transcripts[req.params.sessionId] = { text: TranscriptionText, time: new Date().toISOString() };
    app.locals.db.write(data);
  }
  res.sendStatus(200);
});
app.post("/api/calling/call-status/:sessionId", (req, res) => {
  const { CallStatus, CallDuration } = req.body;
  const data = app.locals.db.read();
  const session = [...callSessions.values()].find(s => s.callSid === req.body.CallSid);
  if (session?.lead) {
    const lead = data.leads.find(l => l.id === session.lead.id);
    if (lead) { lead.callStatus = CallStatus; lead.callDuration = CallDuration; }
    if (!data.calls) data.calls = [];
    if (CallStatus === "completed") data.calls.push({ leadId: session.lead.id, leadName: session.lead.name, phone: session.lead.phone, status: CallStatus, duration: CallDuration, time: new Date().toISOString() });
    app.locals.db.write(data);
  }
  res.sendStatus(200);
});

// ── WhatsApp Incoming ─────────────────────────────────────────
app.post("/api/whatsapp/incoming", async (req, res) => {
  const { handleIncomingWhatsApp } = require("./services/whatsappService");
  await handleIncomingWhatsApp(req.body.From, req.body.Body, app.locals.db);
  res.type("text/xml").send(`<?xml version="1.0"?><Response/>`);
});

// ── Telegram Bot ──────────────────────────────────────────────
const { handleUpdate, setupWebhook, sendStartupNotification } = require("./services/telegramBot");
app.post("/api/telegram/webhook", async (req, res) => {
  res.sendStatus(200);
  try { await handleUpdate(req.body, app.locals.db); } catch(e) { console.error("[Telegram]", e.message); }
});
app.get("/api/telegram/setup", async (req, res) => {
  const result = await setupWebhook(process.env.BASE_URL);
  res.json(result);
});
app.post("/api/telegram/test", async (req, res) => {
  const { sendTelegram } = require("./services/telegramBot");
  await sendTelegram("✅ Test message! Bot is working 🤖");
  res.json({ success: true });
});

// ── Website Chatbot ───────────────────────────────────────────
const { processMessage, getGreeting } = require("./services/chatbotService");
app.post("/api/chatbot/greet", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  try {
    const reply = await getGreeting(sessionId);
    res.json({ reply, quickReplies: ["Haan interested hoon!", "Price kya hai?", "Pehle info chahiye"], sessionId });
  } catch { res.json({ reply: "Namaste! Website banana chahte hain?", sessionId }); }
});
app.post("/api/chatbot/message", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
  try {
    const result = await processMessage(sessionId, message, app.locals.db);
    res.json(result);
  } catch(e) {
    res.json({ reply: "Sorry, thodi problem! Call karo: " + (process.env.AGENCY_PHONE||""), sessionId });
  }
});

// ── Google OAuth ──────────────────────────────────────────────
app.get("/auth/google", async (req, res) => {
  const { getAuthUrl } = require("./services/meetingService");
  res.redirect(await getAuthUrl());
});
app.get("/auth/google/callback", async (req, res) => {
  const { getTokensFromCode } = require("./services/meetingService");
  const tokens = await getTokensFromCode(req.query.code);
  res.send(`<pre>✅ GOOGLE_REFRESH_TOKEN:\n\n${tokens.refresh_token}\n\nCopy to .env and restart.</pre>`);
});

// ── Report + Campaigns ────────────────────────────────────────
app.post("/api/report/send-now", async (req, res) => {
  const { sendReportNow } = require("./services/dailyReportService");
  res.json({ success: true });
  setImmediate(() => sendReportNow(app.locals.db));
});
app.post("/api/leads/campaigns/email/start", async (req, res) => {
  res.json({ success: true });
  const data = app.locals.db.read();
  const { sendEmailWithRetry } = require("./services/retryService");
  for (const lead of data.leads.filter(l=>l.status==="new")) {
    await sendEmailWithRetry(lead, app.locals.db, "cold");
    await new Promise(r=>setTimeout(r,2000));
  }
});
app.post("/api/leads/campaigns/call/start", (req, res) => {
  res.json({ success: true });
  const data    = app.locals.db.read();
  const targets = data.leads.filter(l=>!["closed","dnc","meeting"].includes(l.status));
  const { processLeadAutomatically } = require("./services/autoOrchestrator");
  (async()=>{ for(const lead of targets){ await processLeadAutomatically(lead,app.locals.db); await new Promise(r=>setTimeout(r,35000)); } })();
});

// ── Health & Root ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  const { isCallAllowed } = require("./services/guardService");
  const c = isCallAllowed();
  res.json({ ok: true, time: new Date().toISOString(), callsAllowed: c.allowed, callTime: c.currentIST });
});
app.get("/", (req, res) => res.redirect("/dashboard.html"));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ AI CRM v3 running → http://localhost:${PORT}`);
  console.log(`📊 Dashboard        → http://localhost:${PORT}/dashboard.html`);
  console.log(`❤️  Health          → http://localhost:${PORT}/health\n`);
  const { scheduleDailyReport } = require("./services/dailyReportService");
  scheduleDailyReport(app.locals.db);
  const { restoreScheduledFollowUps } = require("./services/followUpScheduler");
  restoreScheduledFollowUps(app.locals.db);
  setupWebhook(process.env.BASE_URL).catch(()=>{});
  sendStartupNotification().catch(()=>{});
  console.log("📅 Daily report scheduled at 8:00 AM IST");
  console.log("🔄 Follow-up queue restored\n");
});

module.exports = { app, server };
