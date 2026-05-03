// services/autoOrchestrator.js
// Brain — lead aaya → score → email → call → WhatsApp → meeting
// All 7 fixes integrated

const { generateLeadScore }           = require("./leadScoringService");
const { sendEmailWithRetry }          = require("./retryService");
const { makeConversationalCall }      = require("./callService");
const { sendWhatsAppWithRetry }       = require("./retryService");
const { autoScheduleForInterestedLead } = require("./meetingService");
const { updateGoogleSheet }           = require("./sheetUpdateService");
const { runAllGuards, addToDNC }      = require("./guardService");
const { scheduleFollowUp }            = require("./followUpScheduler");

const DELAY = {
  AFTER_EMAIL:   5  * 60 * 1000,
  AFTER_CALL:   10  * 60 * 1000,
  RETRY_NO_ANS: 60  * 60 * 1000,
  FOLLOWUP: 3 * 24 * 60 * 60 * 1000,
};

async function processLeadAutomatically(lead, db) {
  const log = (msg) => {
    console.log(`[AUTO][${lead.name}] ${msg}`);
    appendLeadLog(lead.id, msg, db);
  };

  try {
    log("🚀 Automation started");

    // Guards: DNC, duplicate, call hours wait
    const guard = await runAllGuards(lead, db);
    if (guard.blocked) {
      log(`🚫 Blocked: ${guard.reason}`);
      await updateGoogleSheet(lead.rowIndex, {
        status: guard.type === "dnc" ? "DNC" : "Duplicate",
        lastUpdated: new Date().toLocaleString("hi-IN"),
      });
      return { blocked: true, reason: guard.reason };
    }

    // Score
    log("📊 Scoring lead...");
    const score = await generateLeadScore(lead);
    lead.score = score.total;
    lead.priority = score.priority;
    saveLead(lead, db);
    await updateGoogleSheet(lead.rowIndex, { leadScore: score.total, status: "Scored" });
    log(`Score: ${score.total}/100 [${score.priority}]`);

    const doCall = score.total >= 30;

    // Email with retry
    log("📧 Sending email...");
    const emailResult = await sendEmailWithRetry(lead, db, "cold");
    if (emailResult.success) {
      lead.emailSent = new Date().toISOString();
      saveLead(lead, db);
      await updateGoogleSheet(lead.rowIndex, {
        emailSent: new Date().toLocaleString("hi-IN"),
        status: "Email Sent",
      });
      log(`✅ Email sent (attempt ${emailResult.attempts})`);
    } else {
      log(`❌ Email failed: ${emailResult.error}`);
    }

    if (!doCall) {
      log("⏭️ Score < 30 — email only, no call");
      return;
    }

    log(`⏳ Waiting ${DELAY.AFTER_EMAIL / 60000} min before calling...`);
    await sleep(DELAY.AFTER_EMAIL);

    log("📞 Initiating AI conversational call...");
    const callResult = await makeConversationalCall(lead, db);
    log(`📞 Call outcome: ${callResult.outcome}`);

    if (callResult.outcome === "interested") {
      lead.status = "interested";
      log("🎉 INTERESTED — scheduling Google Meet...");
      const meeting = await autoScheduleForInterestedLead(lead, db);
      await updateGoogleSheet(lead.rowIndex, {
        callStatus: "Answered", callResponse: "Interested",
        callRecording: callResult.recordingUrl || "",
        meetingLink: meeting.success ? meeting.meetLink : "",
        meetingTime: meeting.success ? new Date(meeting.startTime).toLocaleString("hi-IN") : "",
        status: meeting.success ? "Meeting Scheduled" : "Interested",
      });
    } else if (callResult.outcome === "not_interested") {
      lead.status = "closed";
      addToDNC(lead, "Said not interested on call");
      await updateGoogleSheet(lead.rowIndex, {
        callStatus: "Answered", callResponse: "Not Interested",
        callRecording: callResult.recordingUrl || "", status: "Closed",
      });
      log("❌ Not interested — added to DNC");
      return;
    } else if (callResult.outcome === "call_later") {
      lead.status = "contacted";
      await updateGoogleSheet(lead.rowIndex, {
        callStatus: "Answered", callResponse: "Call Later",
        callRecording: callResult.recordingUrl || "", status: "Follow-up Pending",
      });
      scheduleFollowUp(lead, db, "day3_email", DELAY.FOLLOWUP);
      log("🔄 Call later — follow-up in 3 days");
    } else {
      await updateGoogleSheet(lead.rowIndex, {
        callStatus: callResult.outcome === "no_answer" ? "No Answer" : "Failed",
        status: "Retry Pending",
      });
      log(`📵 ${callResult.outcome} — retry in 1 hr`);
      await sleep(DELAY.RETRY_NO_ANS);
      const retry = await makeConversationalCall(lead, db);
      if (retry.outcome === "no_answer") {
        await updateGoogleSheet(lead.rowIndex, { callStatus: "No Answer x2", status: "Contacted" });
        scheduleFollowUp(lead, db, "day3_email", DELAY.FOLLOWUP);
      }
    }

    // WhatsApp follow-up
    if (callResult.outcome !== "not_interested") {
      await sleep(DELAY.AFTER_CALL);
      log("💬 Sending WhatsApp...");
      const waResult = await sendWhatsAppWithRetry(lead, db, callResult.outcome);
      if (waResult.success) {
        await updateGoogleSheet(lead.rowIndex, { whatsappSent: new Date().toLocaleString("hi-IN") });
        log("✅ WhatsApp sent");
      }
    }

    saveLead(lead, db);
    log("✅ Full automation cycle complete");
  } catch (err) {
    console.error(`[AUTO][${lead.name}] ERROR:`, err.message);
    appendLeadLog(lead.id, `❌ Error: ${err.message}`, db);
    await updateGoogleSheet(lead.rowIndex, { status: "Error — check logs" }).catch(() => {});
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function saveLead(lead, db) {
  const data = db.read();
  const idx  = data.leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) data.leads[idx] = { ...data.leads[idx], ...lead };
  else data.leads.push(lead);
  db.write(data);
}

function appendLeadLog(leadId, message, db) {
  try {
    const data = db.read();
    if (!data.logs) data.logs = {};
    if (!data.logs[leadId]) data.logs[leadId] = [];
    data.logs[leadId].push({ time: new Date().toISOString(), message });
    if (data.logs[leadId].length > 100) data.logs[leadId] = data.logs[leadId].slice(-100);
    db.write(data);
  } catch {}
}

module.exports = { processLeadAutomatically };
