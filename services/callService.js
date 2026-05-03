// services/callService.js — Conversational AI Calling
// Real 2-way: Lead bolega → AI samjhega → jawab dega
// Twilio Media Streams + Claude Sonnet

const twilio    = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const fs        = require("fs");
const path      = require("path");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECORDINGS_DIR = "./recordings";
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);

const callSessions = new Map();

async function makeConversationalCall(lead, db) {
  return new Promise(async (resolve) => {
    try {
      const sessionId = `call_${lead.id}_${Date.now()}`;
      callSessions.set(sessionId, { lead, db, conversationHistory: [], outcome: null, recordingUrl: null, resolve, transcript: [] });

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect><Stream url="wss://${process.env.BASE_DOMAIN}/api/calling/stream/${sessionId}"/></Connect>
  <Record action="${process.env.BASE_URL}/api/calling/recording-done/${sessionId}"
    transcribe="true" transcribeCallback="${process.env.BASE_URL}/api/calling/transcription/${sessionId}"
    maxLength="300"/>
</Response>`;

      const call = await client.calls.create({
        twiml,
        to:   "+91" + lead.phone.replace(/\D/g,"").slice(-10),
        from: process.env.TWILIO_PHONE_NUMBER,
        statusCallback: `${process.env.BASE_URL}/api/calling/call-status/${sessionId}`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed","no-answer","busy","failed"],
      });
      callSessions.get(sessionId).callSid = call.sid;
      console.log(`[Call] Started: ${lead.name} — ${call.sid}`);

      setTimeout(() => {
        const s = callSessions.get(sessionId);
        if (s && !s.outcome) { s.outcome = "no_answer"; resolve({ outcome: "no_answer", recordingUrl: null }); callSessions.delete(sessionId); }
      }, 5 * 60 * 1000);
    } catch (err) {
      console.error("[Call] Failed:", err.message);
      resolve({ outcome: "error", error: err.message });
    }
  });
}

function handleMediaStream(ws, sessionId) {
  const session = callSessions.get(sessionId);
  if (!session) { ws.close(); return; }
  ws.on("message", async (data) => {
    const msg = JSON.parse(data);
    if (msg.event === "start") { session.streamSid = msg.start.streamSid; await sendAIGreeting(ws, session, session.streamSid); }
    if (msg.event === "stop")  { finalizeCall(session, ws); }
  });
  ws.on("close", () => { if (!session.outcome) session.outcome = "completed"; });
}

async function sendAIGreeting(ws, session, streamSid) {
  const greeting = await generateAIResponse(session, null, "greeting");
  session.transcript.push({ role: "assistant", text: greeting });
  speakOnCall(ws, streamSid, greeting);
}

async function generateAIResponse(session, userSpeech, stage = "conversation") {
  const { lead } = session;
  const systemPrompt = `You are an AI sales agent for ${process.env.AGENCY_NAME || "WebPro Agency"} calling ${lead.name} from ${lead.business}.
Goal: Get them to book a Google Meet demo for website design.
Rules: Speak Hinglish. SHORT (2-3 sentences). Friendly not pushy.
If YES: say meeting invite coming, goodbye. If NO: thank them, goodbye. If LATER: say will call back, goodbye.
After response on NEW LINE write: OUTCOME:interested OR OUTCOME:not_interested OR OUTCOME:call_later OR OUTCOME:continuing
Context: ${lead.business} in ${lead.city||"India"}. Website from Rs.8,000. Free Meet demo available.`;

  const messages = [...session.conversationHistory, ...(userSpeech ? [{role:"user",content:userSpeech}] : [])];
  if (stage === "greeting") messages.push({ role:"user", content:"START_GREETING" });

  const response = await ai.messages.create({
    model: "claude-sonnet-4-20250514", max_tokens: 200,
    system: systemPrompt,
    messages: messages.length > 0 ? messages : [{role:"user",content:"START_GREETING"}],
  });

  const fullText   = response.content[0].text;
  const lines      = fullText.split("\n").filter(l => l.trim());
  const outcomeL   = lines.find(l => l.startsWith("OUTCOME:"));
  const spokenText = lines.filter(l => !l.startsWith("OUTCOME:")).join(" ").trim();

  if (outcomeL) { const o = outcomeL.replace("OUTCOME:","").trim(); if (o !== "continuing") session.outcome = o; }
  if (userSpeech) session.conversationHistory.push({ role:"user", content:userSpeech });
  session.conversationHistory.push({ role:"assistant", content:spokenText });
  return spokenText;
}

function speakOnCall(ws, streamSid, text) {
  if (!ws || !streamSid) return;
  ws.send(JSON.stringify({ event:"sendText", streamSid, text, voice:"Polly.Aditi", language:"hi-IN" }));
}

async function handleLeadSpeech(sessionId, speechText) {
  const session = callSessions.get(sessionId);
  if (!session) return;
  console.log(`[Call][${session.lead.name}] Lead: "${speechText}"`);
  session.transcript.push({ role:"user", text:speechText });
  const aiReply = await generateAIResponse(session, speechText);
  session.transcript.push({ role:"assistant", text:aiReply });
  speakOnCall(null, session.streamSid, aiReply);
  if (session.outcome && session.outcome !== "continuing") {
    setTimeout(() => finalizeCall(session, null), 3000);
  }
}

function finalizeCall(session) {
  const { lead, db, outcome, transcript, resolve, recordingUrl } = session;
  const finalOutcome = outcome || "completed";
  const data = db.read();
  if (!data.transcripts) data.transcripts = {};
  data.transcripts[lead.id] = { leadName:lead.name, phone:lead.phone, outcome:finalOutcome, transcript, time:new Date().toISOString() };
  const idx = data.leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) { data.leads[idx].callOutcome = finalOutcome; data.leads[idx].callTranscript = transcript; data.leads[idx].recordingUrl = recordingUrl; data.leads[idx].lastContact = new Date().toLocaleDateString("hi-IN"); }
  db.write(data);
  resolve({ outcome: finalOutcome, recordingUrl, transcript });
  callSessions.delete(lead.id);
}

async function saveRecording(recordingUrl, recordingSid, sessionId, db) {
  const session  = callSessions.get(sessionId);
  const https    = require("https");
  const filename = `${sessionId}_${recordingSid}.mp3`;
  const filepath = path.join(RECORDINGS_DIR, filename);
  return new Promise((resolve) => {
    const file    = fs.createWriteStream(filepath);
    const authUrl = recordingUrl.replace("https://", `https://${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}@`);
    https.get(authUrl + ".mp3", res => {
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        const publicUrl = `${process.env.BASE_URL}/recordings/${filename}`;
        if (session) session.recordingUrl = publicUrl;
        const data = db.read();
        if (!data.recordings) data.recordings = [];
        data.recordings.unshift({ sessionId, recordingSid, filename, url:publicUrl, path:filepath, time:new Date().toISOString() });
        db.write(data);
        resolve({ success:true, url:publicUrl });
      });
    }).on("error", err => resolve({ success:false, error:err.message }));
  });
}

module.exports = { makeConversationalCall, handleMediaStream, handleLeadSpeech, saveRecording, callSessions };
