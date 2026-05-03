// services/retryService.js
// FIX 6: Exponential backoff retry for email/call/WhatsApp
// Email fail: 3 retries at 10s, 20s, 40s
// Call fail: 2 retries at 30s, 60s

async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseDelayMs = 5000, label = "operation", onFailure = null } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) console.log(`[Retry] ${label} succeeded on attempt ${attempt}`);
      return { success: true, result, attempts: attempt };
    } catch (err) {
      lastError = err;
      console.warn(`[Retry] ${label} failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[Retry] Waiting ${delay/1000}s before retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.error(`[Retry] ${label} FAILED after ${maxRetries} attempts: ${lastError?.message}`);
  if (onFailure) await onFailure(lastError);
  return { success: false, error: lastError?.message, attempts: maxRetries };
}

async function sendEmailWithRetry(lead, db, type = "cold") {
  const { sendEmail } = require("./emailService");
  const result = await withRetry(
    () => sendEmail(lead, type),
    {
      maxRetries: 3, baseDelayMs: 10000, label: `Email to ${lead.name}`,
      onFailure: async (err) => {
        logFailure(lead, "email", err?.message || "Unknown", db);
        const { updateGoogleSheet } = require("./sheetUpdateService");
        await updateGoogleSheet(lead.rowIndex, { emailSent: "Failed", status: "Email Failed" });
      },
    }
  );
  if (result.success) logSuccess(lead, "email", db);
  return result;
}

async function makeCallWithRetry(lead, db) {
  const { makeConversationalCall } = require("./callService");
  return withRetry(
    () => makeConversationalCall(lead, db),
    {
      maxRetries: 2, baseDelayMs: 30000, label: `Call to ${lead.name}`,
      onFailure: async (err) => {
        logFailure(lead, "call", err?.message, db);
        const { updateGoogleSheet } = require("./sheetUpdateService");
        await updateGoogleSheet(lead.rowIndex, { callStatus: "Failed" });
      },
    }
  );
}

async function sendWhatsAppWithRetry(lead, db, outcome) {
  const { sendWhatsApp } = require("./whatsappService");
  return withRetry(
    () => sendWhatsApp(lead, outcome),
    { maxRetries: 3, baseDelayMs: 5000, label: `WhatsApp to ${lead.name}`, onFailure: (err) => logFailure(lead, "whatsapp", err?.message, db) }
  );
}

function logFailure(lead, type, errorMsg, db) {
  const data = db.read();
  if (!data.failures) data.failures = [];
  data.failures.push({ leadId: lead.id, leadName: lead.name, phone: lead.phone, type, error: errorMsg, time: new Date().toISOString(), retried: true });
  if (data.failures.length > 200) data.failures = data.failures.slice(-200);
  db.write(data);
  console.error(`[Failure] Logged: ${type} for ${lead.name}`);
}

function logSuccess(lead, type, db) {
  const data = db.read();
  if (data.failures) {
    data.failures = data.failures.filter(f => !(f.leadId === lead.id && f.type === type));
    db.write(data);
  }
}

function getFailures(db, limit = 50) {
  const data = db.read();
  return (data.failures || []).slice(-limit).reverse();
}

async function retryAllFailures(db) {
  const failures = getFailures(db, 100);
  const unique = [...new Map(failures.map(f => [f.leadId + f.type, f])).values()];
  console.log(`[Retry] Retrying ${unique.length} failed operations...`);
  for (const failure of unique) {
    const data = db.read();
    const lead = data.leads.find(l => l.id === failure.leadId);
    if (!lead) continue;
    if (failure.type === "email")     await sendEmailWithRetry(lead, db);
    if (failure.type === "call")      await makeCallWithRetry(lead, db);
    if (failure.type === "whatsapp") await sendWhatsAppWithRetry(lead, db, "default");
    await new Promise(r => setTimeout(r, 2000));
  }
}

module.exports = { withRetry, sendEmailWithRetry, makeCallWithRetry, sendWhatsAppWithRetry, getFailures, retryAllFailures, logFailure };
