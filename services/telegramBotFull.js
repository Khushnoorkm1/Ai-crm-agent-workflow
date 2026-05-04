// services/telegramBotFull.js
// RENAME THIS FILE TO: telegramBot.js
// (replaces the stub version)
//
// Phone se poora CRM control — native https, no external library
// Commands: /start /stats /leads /run /email /call /report
//           /dnc /dnc_list /failures /retry /recordings /pipeline /help

const https = require("https");
const { buildStats } = require("./dailyReportService");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const BASE_URL  = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegram(text, chatId = CHAT_ID, opts = {}) {
  if (!BOT_TOKEN || !chatId) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...opts });
  return new Promise((resolve) => {
    const req = https.request(`${BASE_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", err => { console.error("[Telegram]", err.message); resolve(null); });
    req.write(body); req.end();
  });
}

async function notify(message) { return sendTelegram(message); }
function makeKeyboard(rows) { return { reply_markup: JSON.stringify({ inline_keyboard: rows }) }; }

async function handleUpdate(update, db) {
  const msg      = update.message || update.callback_query?.message;
  const text     = update.message?.text || update.callback_query?.data || "";
  const chatId   = msg?.chat?.id;
  const username = msg?.chat?.username || msg?.chat?.first_name || "User";

  if (CHAT_ID && String(chatId) !== String(CHAT_ID)) return sendTelegram("⛔ Unauthorized.", chatId);
  if (update.callback_query) await answerCallbackQuery(update.callback_query.id);

  const cmd = text.split(" ")[0].toLowerCase();
  const arg = text.split(" ").slice(1).join(" ").trim();
  console.log(`[Telegram] ${cmd} from ${username}`);

  switch (cmd) {
    case "/start": case "/menu": return handleStart(chatId, username);
    case "/stats":               return handleStats(chatId, db);
    case "/leads":               return handleLeads(chatId, db, arg);
    case "/run": case "/run_all": return handleRunAll(chatId, db);
    case "/email":               return handleEmailCampaign(chatId, db);
    case "/call":                return handleCallCampaign(chatId, db);
    case "/report":              return handleReport(chatId, db);
    case "/dnc":                 return handleDNC(chatId, arg, db);
    case "/dnc_list":            return handleDNCList(chatId, db);
    case "/failures":            return handleFailures(chatId, db);
    case "/retry":               return handleRetry(chatId, db);
    case "/recordings":          return handleRecordings(chatId, db);
    case "/pipeline":            return handlePipeline(chatId, db);
    case "/help":                return handleHelp(chatId);
    case "run_all":               return handleRunAll(chatId, db);
    case "email_camp":            return handleEmailCampaign(chatId, db);
    case "call_camp":             return handleCallCampaign(chatId, db);
    case "stats":                 return handleStats(chatId, db);
    case "leads":                 return handleLeads(chatId, db, "");
    case "report":                return handleReport(chatId, db);
    default: return sendTelegram("❓ Unknown. /help for all commands.", chatId);
  }
}

async function handleStart(chatId, username) {
  const { isCallAllowed } = require("./guardService");
  const c = isCallAllowed();
  return sendTelegram(
    `🤖 <b>AI CRM Bot</b>\nNamaste ${username}!\n\n📞 Calls: ${c.allowed ? "✅ Active" : "🔴 Off"} (${c.currentIST})\n\nChoose:`,
    chatId, makeKeyboard([
      [{text:"📊 Stats",callback_data:"stats"},{text:"👥 Leads",callback_data:"leads"}],
      [{text:"🚀 Run All",callback_data:"run_all"},{text:"📧 Email",callback_data:"email_camp"}],
      [{text:"📞 Calls",callback_data:"call_camp"},{text:"📋 Report",callback_data:"report"}],
    ])
  );
}

async function handleStats(chatId, db) {
  const stats = buildStats(db.read());
  const { isCallAllowed } = require("./guardService"); const c = isCallAllowed();
  return sendTelegram(`📊 <b>Today's Stats</b>\n\n📞 Calls: <b>${stats.callsToday}</b>\n📧 Emails: <b>${stats.emailsToday}</b>\n🆕 New: <b>${stats.newToday}</b>\n🎯 Interested: <b>${stats.interested}</b>\n📅 Meetings: <b>${stats.meetings}</b>\n💰 Conversion: <b>${stats.conversion}%</b>\n⚠️ Failures: <b>${stats.failures}</b>\n\n📟 Total: <b>${stats.totalLeads}</b>\n📞: ${c.allowed?"✅ Active":"🔴 Off "+c.currentIST}`,
    chatId, makeKeyboard([[{text:"🔄 Refresh",callback_data:"stats"},{text:"📋 Report",callback_data:"report"}]])
  );
}

async function handleLeads(chatId, db, filter) {
  const leads = (db.read().leads||[]).filter(l=>!filter||l.status===filter).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,8);
  if (!leads.length) return sendTelegram("👥 No leads found.", chatId);
  const e = {new:"🆕",contacted:"📞",interested:"🎯",meeting:"📅",closed:"✅",dnc:"🚫"};
  return sendTelegram(`👥 <b>Top Leads</b>\n\n`+leads.map((l,i)=>`${i+1}. ${e[l.status]||"•"} <b>${l.name}</b>${l.score?` [${l.score}/100]`:""}`+`\n   📱 ${l.phone} | ${l.business||"—"}\n   📍 ${l.city||"—"} | ${l.status}`).join("\n\n"), chatId);
}

async function handleRunAll(chatId, db) {
  const targets = (db.read().leads||[]).filter(l=>!["closed","dnc","meeting"].includes(l.status));
  if (!targets.length) return sendTelegram("✅ No pending leads.", chatId);
  await sendTelegram(`🚀 <b>Starting automation...</b>\n${targets.length} leads queued!\nEmail → Call → WA → Meeting`, chatId);
  const { processLeadAutomatically } = require("./autoOrchestrator");
  let done = 0;
  (async()=>{
    for(const lead of targets){
      await processLeadAutomatically(lead, db); done++;
      if(done%3===0) await sendTelegram(`⏳ Progress: ${done}/${targets.length}`, chatId);
      await new Promise(r=>setTimeout(r,35000));
    }
    await sendTelegram(`✅ <b>Done!</b> ${done} processed. /stats`, chatId);
  })();
}

async function handleEmailCampaign(chatId, db) {
  const targets = (db.read().leads||[]).filter(l=>l.status==="new");
  await sendTelegram(`📧 Sending to ${targets.length} new leads...`, chatId);
  const { sendEmailWithRetry } = require("./retryService");
  let sent=0,failed=0;
  for(const lead of targets){ const r=await sendEmailWithRetry(lead,db,"cold"); r.success?sent++:failed++; await new Promise(r=>setTimeout(r,2000)); }
  return sendTelegram(`📧 Done! ✅ ${sent} sent ❌ ${failed} failed`, chatId);
}

async function handleCallCampaign(chatId, db) {
  const { isCallAllowed } = require("./guardService"); const c = isCallAllowed();
  if(!c.allowed) return sendTelegram(`🔴 Calls blocked! ${c.reason}`, chatId);
  const targets = (db.read().leads||[]).filter(l=>!["closed","dnc","meeting"].includes(l.status));
  await sendTelegram(`📞 Calling ${targets.length} leads...`, chatId);
  const { makeConversationalCall } = require("./callService");
  for(const lead of targets){
    await sendTelegram(`📞 Calling: <b>${lead.name}</b>`, chatId);
    const r = await makeConversationalCall(lead,db);
    await sendTelegram(`${r.outcome==="interested"?"🎯":r.outcome==="not_interested"?"❌":"🔄"} ${lead.name}: ${r.outcome}`, chatId);
    await new Promise(r=>setTimeout(r,35000));
  }
  return sendTelegram("✅ Call campaign complete!", chatId);
}

async function handleReport(chatId, db) {
  await sendTelegram("📋 Generating report...", chatId);
  await require("./dailyReportService").sendDailyReport(db);
  return sendTelegram("✅ Report sent! Check email. 📧", chatId);
}

async function handleDNC(chatId, phone, db) {
  if(!phone) return sendTelegram("Usage: <code>/dnc 9876543210</code>", chatId);
  const { addToDNC } = require("./guardService"); const data = db.read();
  const lead = data.leads.find(l=>String(l.phone||"").slice(-10)===phone.replace(/\D/g,"").slice(-10));
  addToDNC({name:lead?.name||phone,phone,email:lead?.email||""}, "Blocked via Telegram");
  if(lead){lead.status="dnc";db.write(data);}
  return sendTelegram(`🚫 <b>${lead?.name||phone}</b> blocked!`, chatId);
}

async function handleDNCList(chatId, db) {
  const dnc = require("./guardService").getDNCList();
  if(!dnc.numbers.length) return sendTelegram("✅ DNC list is empty.", chatId);
  return sendTelegram(`<b>DNC (${dnc.numbers.length})</b>\n\n`+dnc.numbers.map(n=>`🚫 ${n.name||n.phone} — ${n.phone}`).join("\n"), chatId);
}

async function handleFailures(chatId, db) {
  const failures = require("./retryService").getFailures(db, 10);
  if(!failures.length) return sendTelegram("✅ No failures!", chatId);
  return sendTelegram(`⚠️ <b>Failures (${failures.length})</b>\n\n`+failures.slice(0,8).map(f=>`❌ <b>${f.type}</b> — ${f.leadName}: ${(f.error||"").slice(0,50)}`).join("\n"), chatId, makeKeyboard([[{text:"🔄 Retry All",callback_data:"retry_all"}]]));
}

async function handleRetry(chatId, db) {
  await sendTelegram("🔄 Retrying...", chatId);
  await require("./retryService").retryAllFailures(db);
  return sendTelegram("✅ Retry done! /failures se check karo.", chatId);
}

async function handleRecordings(chatId, db) {
  const recs = (db.read().recordings||[]).slice(-5).reverse();
  if(!recs.length) return sendTelegram("🎤 No recordings yet.", chatId);
  return sendTelegram(`🎤 <b>Recordings</b>\n\n`+recs.map((r,i)=>{ const d=`${Math.floor((r.duration||0)/60)}:${String((r.duration||0)%60).padStart(2,"0")}`; return `${i+1}. <b>${r.leadName||"?"}</b> — ${d}\n   🔗 <a href="${r.url}">Play</a>`; }).join("\n\n"), chatId);
}

async function handlePipeline(chatId, db) {
  const leads = db.read().leads||[];
  const c = leads.reduce((a,l)=>{a[l.status]=(a[l.status]||0)+1;return a;},{});
  const max = Math.max(...Object.values(c),1);
  const bar = n=>"█".repeat(Math.round(n/max*10))+"░".repeat(10-Math.round(n/max*10));
  return sendTelegram(`📊 <b>Pipeline</b>\n\n🆕 New:        ${bar(c.new||0)} ${c.new||0}\n📞 Contacted:  ${bar(c.contacted||0)} ${c.contacted||0}\n🎯 Interested: ${bar(c.interested||0)} ${c.interested||0}\n📅 Meeting:    ${bar(c.meeting||0)} ${c.meeting||0}\n✅ Closed:     ${bar(c.closed||0)} ${c.closed||0}\n🚫 DNC:        ${bar(c.dnc||0)} ${c.dnc||0}\n\n<b>Total: ${leads.length}</b>`, chatId);
}

async function handleHelp(chatId) {
  return sendTelegram(`🤖 <b>AI CRM — All Commands</b>\n\n<b>📊 Reports</b>\n/stats /pipeline /report /leads\n\n<b>🚀 Campaigns</b>\n/run /email /call /retry\n\n<b>🚫 DNC</b>\n/dnc 9876543210 — block\n/dnc_list — see list\n\n<b>⚠️ Monitor</b>\n/failures /recordings\n\n/menu — Main menu`, chatId);
}

async function answerCallbackQuery(id) {
  const body = JSON.stringify({ callback_query_id: id });
  return new Promise(r=>{ const req=https.request(`${BASE_URL}/answerCallbackQuery`,{method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},(res)=>{res.resume();r();});req.on("error",r);req.write(body);req.end(); });
}

async function setupWebhook(baseUrl) {
  if (!baseUrl || !BOT_TOKEN) return;
  const url = `${baseUrl}/api/telegram/webhook`;
  const body = JSON.stringify({ url });
  return new Promise(resolve=>{
    const req=https.request(`${BASE_URL}/setWebhook`,{method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},res=>{
      let data="";res.on("data",d=>data+=d);res.on("end",()=>{const r=JSON.parse(data);if(r.ok)console.log(`[Telegram] Webhook: ${url}`);else console.error("[Telegram] Error:",r.description);resolve(r);});
    });req.on("error",resolve);req.write(body);req.end();
  });
}

async function sendStartupNotification() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await sendTelegram(`✅ <b>AI CRM Server Started!</b>\n\n/menu se control karo 🎮`);
}

module.exports = { handleUpdate, notify, sendTelegram, setupWebhook, sendStartupNotification };
