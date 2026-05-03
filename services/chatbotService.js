// services/chatbotService.js
// Website chatbot — visitor se naam/phone lo, CRM mein add karo
// Stages: greeting → collecting_name → collecting_phone → collecting_email → done

const Anthropic = require("@anthropic-ai/sdk");
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const chatSessions = new Map();

function getSession(sessionId) {
  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, { id: sessionId, stage: "greeting", lead: {}, history: [], createdAt: new Date().toISOString() });
  }
  return chatSessions.get(sessionId);
}

async function processMessage(sessionId, userMessage, db) {
  const session = getSession(sessionId);
  session.history.push({ role: "user", content: userMessage });

  const systemPrompt = `You are a friendly website chat assistant for ${process.env.AGENCY_NAME || "WebPro Agency"}, a website design company in India.
Goal: Collect visitor's name, business, phone, email naturally.
Current stage: ${session.stage}
Collected: ${JSON.stringify(session.lead)}
Rules:
- Speak Hinglish (Hindi + English)
- Keep SHORT (1-3 lines)
- Ask ONE thing at a time
- Pricing: "Starting Rs.8,000 se! Free consultation available"
- When name+phone collected: say team will reach out
After response write on NEW LINE:
STAGE:<next_stage>
EXTRACTED_NAME:<name or empty>
EXTRACTED_PHONE:<10-digit or empty>
EXTRACTED_EMAIL:<email or empty>
EXTRACTED_BUSINESS:<business or empty>
READY:<true if name+phone done>`;

  const response = await ai.messages.create({
    model: "claude-sonnet-4-20250514", max_tokens: 300,
    system: systemPrompt, messages: session.history,
  });

  const fullText  = response.content[0].text;
  const lines     = fullText.split("\n");
  const metaStart = lines.findIndex(l => l.startsWith("STAGE:"));
  const reply     = (metaStart > 0 ? lines.slice(0, metaStart) : lines).join("\n").trim();
  const getMeta   = (key) => { const l = lines.find(x => x.startsWith(`${key}:`)); return l ? l.replace(`${key}:`,"").trim() : ""; };

  session.stage         = getMeta("STAGE")             || session.stage;
  session.lead.name     = getMeta("EXTRACTED_NAME")    || session.lead.name;
  session.lead.phone    = getMeta("EXTRACTED_PHONE")   || session.lead.phone;
  session.lead.email    = getMeta("EXTRACTED_EMAIL")   || session.lead.email;
  session.lead.business = getMeta("EXTRACTED_BUSINESS")|| session.lead.business;
  session.history.push({ role: "assistant", content: reply });

  if (getMeta("READY") === "true" && session.lead.name && session.lead.phone && !session.lead.addedToCRM) {
    session.lead.addedToCRM = true;
    await addLeadToCRM(session.lead, db);
  }

  return { reply, stage: session.stage, leadCaptured: session.lead.addedToCRM || false, sessionId };
}

async function addLeadToCRM(lead, db) {
  const newLead = {
    id: `chat_${Date.now()}`, name: lead.name, business: lead.business || "",
    phone: String(lead.phone).replace(/\D/g,"").slice(-10), email: lead.email || "",
    city: lead.city || "", notes: "Via website chatbot", source: "chatbot",
    status: "new", createdAt: new Date().toISOString(), rowIndex: null,
  };
  const data = db.read();
  data.leads.push(newLead);
  db.write(data);
  console.log(`[Chatbot] Lead captured: ${newLead.name} (${newLead.phone})`);
  try {
    const { notify } = require("./telegramBot");
    await notify(`🆕 <b>New chatbot lead!</b>\n👤 ${newLead.name}\n📱 ${newLead.phone}\n🏢 ${newLead.business || "—"}\n\nAutomation starting...`);
  } catch {}
  const { processLeadAutomatically } = require("./autoOrchestrator");
  setImmediate(() => processLeadAutomatically(newLead, db));
  return newLead;
}

async function getGreeting(sessionId) {
  const session = getSession(sessionId);
  const greetings = [
    `Namaste! 👋 Main ${process.env.AGENCY_NAME || "WebPro Agency"} ka assistant hoon.\n\nKya aap apne business ke liye website banana chahte hain? 😊`,
    `Hi! 👋 ${process.env.AGENCY_NAME || "WebPro Agency"} mein aapka swagat hai!\n\nKya main aapki help kar sakta hoon? 🚀`,
  ];
  const reply = greetings[Math.floor(Math.random() * greetings.length)];
  session.history.push({ role: "assistant", content: reply });
  return reply;
}

module.exports = { processMessage, getGreeting, getSession };
