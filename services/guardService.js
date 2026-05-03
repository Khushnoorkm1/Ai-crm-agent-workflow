// services/guardService.js
// FIX 1: Call Hours Check (10AM-6PM IST only)
// FIX 2: Duplicate Lead Prevention
// FIX 3: DNC (Do Not Call/Contact) List

const fs = require("fs");

const DNC_FILE = "./data/dnc.json";
if (!fs.existsSync("./data")) fs.mkdirSync("./data");
if (!fs.existsSync(DNC_FILE)) fs.writeFileSync(DNC_FILE, JSON.stringify({ numbers: [], emails: [] }));

function isCallAllowed() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const timeVal = hour + minute / 60;
  const allowed = timeVal >= 10 && timeVal < 18;
  return {
    allowed,
    currentIST: `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")} IST`,
    reason: allowed ? "Within calling hours" : `Outside calling hours (10AM-6PM IST). Current: ${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")} IST`,
  };
}

function getNextCallWindow() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const hour = ist.getUTCHours();
  let nextCall = new Date(ist);
  if (hour >= 18) nextCall.setUTCDate(nextCall.getUTCDate() + 1);
  nextCall.setUTCHours(10, 0, 0, 0);
  return new Date(nextCall.getTime() - istOffset);
}

function delayUntilCallAllowed() {
  const check = isCallAllowed();
  if (check.allowed) return Promise.resolve();
  const next = getNextCallWindow();
  const delayMs = next.getTime() - Date.now();
  const delayMins = Math.round(delayMs / 60000);
  console.log(`[Guard] Call blocked. Waiting ${delayMins} min until 10AM IST...`);
  return new Promise(r => setTimeout(r, delayMs));
}

function checkDuplicate(incomingLead, db) {
  const data = db.read();
  const phone = String(incomingLead.phone || "").replace(/\D/g,"").slice(-10);
  const email = (incomingLead.email || "").toLowerCase().trim();
  const byPhone = phone ? data.leads.find(l => String(l.phone||"").replace(/\D/g,"").slice(-10) === phone) : null;
  const byEmail = email ? data.leads.find(l => (l.email||"").toLowerCase().trim() === email && email !== "") : null;
  if (byPhone) return { isDuplicate: true, reason: `Phone ${phone} already exists — ${byPhone.name} (${byPhone.status})`, existing: byPhone };
  if (byEmail) return { isDuplicate: true, reason: `Email ${email} already exists — ${byEmail.name} (${byEmail.status})`, existing: byEmail };
  return { isDuplicate: false };
}

function mergeOrReject(incomingLead, db) {
  const dup = checkDuplicate(incomingLead, db);
  if (!dup.isDuplicate) return { action: "create" };
  const existing = dup.existing;
  if (existing.status === "closed" || existing.status === "dnc") {
    return { action: "reject", reason: `Lead is ${existing.status} — will not reprocess` };
  }
  if (["new","contacted"].includes(existing.status)) {
    const data = db.read();
    const idx = data.leads.findIndex(l => l.id === existing.id);
    if (idx >= 0 && incomingLead.notes) {
      data.leads[idx].notes = [data.leads[idx].notes, incomingLead.notes].filter(Boolean).join(" | ");
      db.write(data);
    }
    return { action: "skip", reason: `Duplicate — already in pipeline (${existing.status})` };
  }
  return { action: "skip", reason: `Duplicate — ${dup.reason}` };
}

function readDNC() { return JSON.parse(fs.readFileSync(DNC_FILE, "utf8")); }
function writeDNC(data) { fs.writeFileSync(DNC_FILE, JSON.stringify(data, null, 2)); }

function addToDNC(lead, reason = "Requested by lead") {
  const dnc = readDNC();
  const phone = String(lead.phone || "").replace(/\D/g,"").slice(-10);
  const email = (lead.email || "").toLowerCase().trim();
  if (phone && !dnc.numbers.find(n => n.phone === phone)) dnc.numbers.push({ phone, name: lead.name, reason, addedAt: new Date().toISOString() });
  if (email && !dnc.emails.find(e => e.email === email))   dnc.emails.push({ email, name: lead.name, reason, addedAt: new Date().toISOString() });
  writeDNC(dnc);
  console.log(`[DNC] Added: ${lead.name} (${phone}) — ${reason}`);
}

function isOnDNC(lead) {
  const dnc = readDNC();
  const phone = String(lead.phone || "").replace(/\D/g,"").slice(-10);
  const email = (lead.email || "").toLowerCase().trim();
  const byPhone = phone ? dnc.numbers.find(n => n.phone === phone) : null;
  const byEmail = email ? dnc.emails.find(e => e.email === email) : null;
  if (byPhone) return { onDNC: true, reason: `Phone on DNC: ${byPhone.reason}` };
  if (byEmail) return { onDNC: true, reason: `Email on DNC: ${byEmail.reason}` };
  return { onDNC: false };
}

function getDNCList() { return readDNC(); }

function removeFromDNC(phone) {
  const dnc = readDNC();
  const clean = String(phone).replace(/\D/g,"").slice(-10);
  dnc.numbers = dnc.numbers.filter(n => n.phone !== clean);
  writeDNC(dnc);
  console.log(`[DNC] Removed: ${clean}`);
}

async function runAllGuards(lead, db) {
  const dncCheck = isOnDNC(lead);
  if (dncCheck.onDNC) {
    console.log(`[Guard] BLOCKED (DNC): ${lead.name}`);
    return { blocked: true, reason: dncCheck.reason, type: "dnc" };
  }
  const dupResult = mergeOrReject(lead, db);
  if (dupResult.action === "reject" || dupResult.action === "skip") {
    console.log(`[Guard] BLOCKED (Duplicate): ${lead.name}`);
    return { blocked: true, reason: dupResult.reason, type: "duplicate" };
  }
  await delayUntilCallAllowed();
  return { blocked: false };
}

module.exports = { isCallAllowed, delayUntilCallAllowed, getNextCallWindow, checkDuplicate, mergeOrReject, addToDNC, isOnDNC, getDNCList, removeFromDNC, runAllGuards };
