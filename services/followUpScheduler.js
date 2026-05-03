// services/followUpScheduler.js
// Day 3/7/14 automatic follow-up sequences
// Day 0: Email + Call (autoOrchestrator)
// Day 3: Follow-up email + WhatsApp
// Day 7: Second call attempt
// Day 14: Final WhatsApp + mark cold

const { sendFollowUp }           = require("./emailService");
const { makeConversationalCall } = require("./callService");
const { sendWhatsApp }           = require("./whatsappService");
const { updateGoogleSheet }      = require("./sheetUpdateService");

const pendingFollowUps = new Map();

function scheduleFollowUp(lead, db, type, delayMs) {
  const key = `${lead.id}_${type}`;
  if (pendingFollowUps.has(key)) clearTimeout(pendingFollowUps.get(key).timer);

  const scheduledAt = new Date(Date.now() + delayMs).toISOString();
  const data = db.read();
  if (!data.scheduledFollowUps) data.scheduledFollowUps = [];
  data.scheduledFollowUps.push({ key, leadId: lead.id, leadName: lead.name, type, scheduledAt, status: "pending" });
  db.write(data);

  const timer = setTimeout(() => { executeFollowUp(lead, db, type); pendingFollowUps.delete(key); }, delayMs);
  pendingFollowUps.set(key, { timer, scheduledAt, type });
  console.log(`[Scheduler] ${lead.name} — ${type} at ${scheduledAt}`);
}

async function executeFollowUp(lead, db, type) {
  const data  = db.read();
  const fresh = data.leads.find(l => l.id === lead.id);
  if (!fresh) return;
  if (["closed","meeting"].includes(fresh.status)) {
    console.log(`[Scheduler] Skip ${fresh.name} — already ${fresh.status}`);
    markFollowUpDone(lead.id, type, db);
    return;
  }
  console.log(`[Scheduler] Executing ${type} for ${fresh.name}`);

  switch (type) {
    case "day3_email":
      await sendFollowUp(fresh);
      await updateGoogleSheet(fresh.rowIndex, { status: "Follow-up Sent", emailSent: `Follow-up: ${new Date().toLocaleString("hi-IN")}` });
      scheduleFollowUp(fresh, db, "day3_whatsapp", 2 * 60 * 60 * 1000);
      break;
    case "day3_whatsapp":
      await sendWhatsApp(fresh, "call_later");
      await updateGoogleSheet(fresh.rowIndex, { whatsappSent: new Date().toLocaleString("hi-IN") });
      scheduleFollowUp(fresh, db, "day7_call", 4 * 24 * 60 * 60 * 1000);
      break;
    case "day7_call":
      const callResult = await makeConversationalCall(fresh, db);
      await updateGoogleSheet(fresh.rowIndex, { callStatus: callResult.outcome === "no_answer" ? "No Answer (D7)" : "Called (D7)", callResponse: callResult.outcome });
      if (callResult.outcome === "not_interested") await updateGoogleSheet(fresh.rowIndex, { status: "Closed" });
      else scheduleFollowUp(fresh, db, "day14_final", 7 * 24 * 60 * 60 * 1000);
      break;
    case "day14_final":
      await sendWhatsApp(fresh, "final_attempt");
      const d2 = db.read();
      const l14 = d2.leads.find(l => l.id === fresh.id);
      if (l14 && ![ "interested","meeting" ].includes(l14.status)) { l14.status = "cold"; db.write(d2); }
      await updateGoogleSheet(fresh.rowIndex, { status: "Cold" });
      break;
  }
  markFollowUpDone(lead.id, type, db);
}

function restoreScheduledFollowUps(db) {
  const data = db.read();
  if (!data.scheduledFollowUps) return;
  const now = Date.now();
  let count = 0;
  data.scheduledFollowUps.filter(f => f.status === "pending").forEach(f => {
    const lead = data.leads.find(l => l.id === f.leadId);
    if (!lead) return;
    const remaining = new Date(f.scheduledAt).getTime() - now;
    if (remaining <= 0) executeFollowUp(lead, db, f.type);
    else { scheduleFollowUp(lead, db, f.type, remaining); count++; }
  });
  console.log(`[Scheduler] Restored ${count} follow-ups`);
}

function markFollowUpDone(leadId, type, db) {
  const data = db.read();
  if (!data.scheduledFollowUps) return;
  const item = data.scheduledFollowUps.find(f => f.leadId === leadId && f.type === type);
  if (item) item.status = "done";
  db.write(data);
}

function getPendingFollowUps(db) {
  const data = db.read();
  return (data.scheduledFollowUps || []).filter(f => f.status === "pending");
}

module.exports = { scheduleFollowUp, executeFollowUp, restoreScheduledFollowUps, getPendingFollowUps };
