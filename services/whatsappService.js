// services/whatsappService.js
// Twilio WhatsApp API — send messages + handle replies
// AI-generated Hinglish messages based on call outcome

const twilio    = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateWhatsAppMessage(lead, callOutcome) {
  const scenarios = {
    interested:     `Lead just said YES on call. Send excited confirmation with meeting link [MEET_LINK]. Short and warm.`,
    call_later:     `Lead said they'll think about it. Friendly reminder. Website: ${process.env.AGENCY_WEBSITE || "#"}`,
    no_answer:      `Couldn't reach on call. Introduce ourselves, ask if they'd like a callback.`,
    not_interested: `Lead wasn't interested. Polite goodbye, leave door open for future.`,
    final_attempt:  `Last follow-up attempt. Friendly, no pressure. Mention we're here when they need us.`,
    default:        `Follow up after first email. Introduce website design services. Friendly tone.`,
  };
  const msg = await ai.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{ role: "user", content: `Write a short WhatsApp message in Hinglish for ${lead.name} (${lead.business}).
Context: ${scenarios[callOutcome] || scenarios.default}
Agency: ${process.env.AGENCY_NAME || "WebPro Agency"}
Rules: Max 3 lines. 1-2 emojis. Conversational. No "Dear" or "Respected".
Return ONLY the message text.` }],
  });
  return msg.content[0].text.trim();
}

async function sendWhatsApp(lead, callOutcome = "default", meetingLink = null) {
  try {
    let text = await generateWhatsAppMessage(lead, callOutcome);
    text = text.replace("[MEET_LINK]", meetingLink || process.env.AGENCY_WEBSITE || "our website");
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER}`,
      to:   `whatsapp:+91${lead.phone.replace(/\D/g,"").slice(-10)}`,
      body: text,
    });
    console.log(`[WhatsApp] Sent to ${lead.name}: ${message.sid}`);
    return { success: true, sid: message.sid, text };
  } catch (err) {
    console.error(`[WhatsApp] Failed for ${lead.name}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendWhatsAppWithMedia(lead, mediaUrl, caption) {
  try {
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to:   `whatsapp:+91${lead.phone.replace(/\D/g,"").slice(-10)}`,
      body: caption || `${lead.name} ji, hamara portfolio dekho! 🌐`,
      mediaUrl: [mediaUrl],
    });
    return { success: true, sid: message.sid };
  } catch (err) { return { success: false, error: err.message }; }
}

async function handleIncomingWhatsApp(from, body, db) {
  const phone = from.replace("whatsapp:+91","").replace("whatsapp:+","");
  const data  = db.read();
  const lead  = data.leads.find(l => l.phone.slice(-10) === phone.slice(-10));
  if (!lead) { console.log(`[WhatsApp] Unknown from ${from}: ${body}`); return; }
  console.log(`[WhatsApp] Reply from ${lead.name}: "${body}"`);

  lead.whatsappResponse  = body;
  lead.whatsappRepliedAt = new Date().toISOString();
  lead.lastContact       = new Date().toLocaleDateString("hi-IN");

  const intentMsg = await ai.messages.create({
    model: "claude-sonnet-4-20250514", max_tokens: 50,
    messages: [{ role: "user", content: `Classify WhatsApp reply intent in one word: "${body}"
Options: INTERESTED, NOT_INTERESTED, QUESTION, MEETING_CONFIRM, CALL_REQUEST, OTHER
Reply with just one word.` }],
  });
  const intent = intentMsg.content[0].text.trim().toUpperCase();
  console.log(`[WhatsApp] Intent for ${lead.name}: ${intent}`);

  if (intent === "INTERESTED" || intent === "MEETING_CONFIRM") {
    lead.status = "interested";
    const { autoScheduleForInterestedLead } = require("./meetingService");
    await autoScheduleForInterestedLead(lead, db);
  } else if (intent === "NOT_INTERESTED") {
    lead.status = "closed";
  }

  const idx = data.leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) data.leads[idx] = lead;
  if (!data.whatsappReplies) data.whatsappReplies = [];
  data.whatsappReplies.push({ leadId: lead.id, leadName: lead.name, phone, message: body, intent, time: new Date().toISOString() });
  db.write(data);

  const { updateGoogleSheet } = require("./sheetUpdateService");
  await updateGoogleSheet(lead.rowIndex, { status: lead.status, notes: `WhatsApp: "${body}" (${intent})` });
  return intent;
}

module.exports = { sendWhatsApp, sendWhatsAppWithMedia, handleIncomingWhatsApp, generateWhatsAppMessage };
