// services/dailyReportService.js
// FIX 7: Daily Report Email at 8:00 AM IST
// Calls, emails, leads, meetings, failures summary

const nodemailer = require("nodemailer");
const Anthropic  = require("@anthropic-ai/sdk");
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let lastReportDate = null;

function scheduleDailyReport(db) {
  sendReportAtTime(db);
  setInterval(() => sendReportAtTime(db), 60 * 1000);
  console.log("[DailyReport] Scheduler started — report at 8:00 AM IST");
}

function sendReportAtTime(db) {
  const now   = new Date();
  const ist   = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const h     = ist.getUTCHours();
  const m     = ist.getUTCMinutes();
  const today = ist.toISOString().split("T")[0];
  if (h === 8 && m === 0 && lastReportDate !== today) {
    lastReportDate = today;
    sendDailyReport(db).catch(err => console.error("[DailyReport] Failed:", err.message));
  }
}

async function sendDailyReport(db) {
  console.log("[DailyReport] Generating...");
  const data  = db.read();
  const stats = buildStats(data);
  const html  = await buildReportHTML(stats);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
  });

  const reportDate = new Date().toLocaleDateString("hi-IN", { timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"long" });
  await transporter.sendMail({
    from: `"AI CRM Report" <${process.env.SMTP_EMAIL}>`,
    to:   process.env.REPORT_EMAIL || process.env.SMTP_EMAIL,
    subject: `[AI CRM] Daily Report — ${reportDate}`,
    html,
  });
  console.log("[DailyReport] Sent!");

  if (!data.reportsSent) data.reportsSent = [];
  data.reportsSent.push({ date: new Date().toISOString(), stats });
  db.write(data);
}

function buildStats(data) {
  const leads    = data.leads    || [];
  const calls    = data.calls    || [];
  const emails   = data.emails   || [];
  const failures = data.failures || [];
  const today    = new Date().toISOString().split("T")[0];
  const byStatus = leads.reduce((a,l) => { a[l.status]=(a[l.status]||0)+1; return a; }, {});
  return {
    date: today, totalLeads: leads.length,
    newToday:    leads.filter(l  => (l.createdAt||"").startsWith(today)).length,
    callsToday:  calls.filter(c  => (c.time     ||"").startsWith(today)).length,
    emailsToday: emails.filter(e => (e.sentAt   ||"").startsWith(today)).length,
    interested:  leads.filter(l => l.status === "interested").length,
    meetings:    leads.filter(l => l.status === "meeting").length,
    closed:      leads.filter(l => l.status === "closed").length,
    failures:    failures.filter(f => (f.time||"").startsWith(today)).length,
    byStatus,
    topLeads: leads.filter(l=>l.score).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5),
    conversion: leads.length ? Math.round((leads.filter(l=>l.status==="meeting").length/leads.length)*100) : 0,
  };
}

async function buildReportHTML(stats) {
  let aiInsight = "Kal aur zyada leads convert karo!";
  try {
    const msg = await ai.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 80,
      messages: [{ role:"user", content:`Write ONE short Hinglish motivational line (max 20 words) for a website sales agent who made ${stats.callsToday} calls today and got ${stats.interested} interested leads. Be specific and energetic.` }],
    });
    aiInsight = msg.content[0].text.trim();
  } catch {}

  const statusRows = Object.entries(stats.byStatus)
    .map(([s,c]) => `<tr><td style="padding:6px 12px;color:#555;text-transform:capitalize">${s}</td><td style="padding:6px 12px;font-weight:600;text-align:right">${c}</td></tr>`).join("");

  const topLeadRows = stats.topLeads
    .map(l => `<tr><td style="padding:6px 12px">${l.name}</td><td style="padding:6px 12px;color:#555">${l.business||""}</td><td style="padding:6px 12px;text-align:right;font-weight:600;color:#185FA5">${l.score}/100</td></tr>`).join("");

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e4de">
  <div style="background:#185FA5;padding:24px 28px;color:#fff">
    <div style="font-size:20px;font-weight:700">AI CRM — Daily Report</div>
    <div style="font-size:13px;opacity:.8;margin-top:4px">${new Date().toLocaleDateString("hi-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
    <div style="margin-top:12px;background:rgba(255,255,255,.15);border-radius:8px;padding:10px 14px;font-size:14px;font-style:italic">${aiInsight}</div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr)">
    ${[["Calls",stats.callsToday,"#185FA5"],["Emails",stats.emailsToday,"#3B6D11"],["New Leads",stats.newToday,"#854F0B"],["Interested",stats.interested,"#3B6D11"],["Meetings",stats.meetings,"#3C3489"],["Conversion",stats.conversion+"%","#185FA5"]].map(([l,v,c])=>`<div style="padding:16px 20px;border-right:1px solid #e5e4de;border-bottom:1px solid #e5e4de"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${l}</div><div style="font-size:24px;font-weight:700;color:${c}">${v}</div></div>`).join("")}
  </div>
  ${stats.failures > 0 ? `<div style="background:#FCEBEB;border-left:4px solid #E24B4A;padding:12px 20px;font-size:13px;color:#A32D2D">\u26A0 ${stats.failures} operations failed today. Open dashboard to retry.</div>` : `<div style="background:#EAF3DE;border-left:4px solid #639922;padding:12px 20px;font-size:13px;color:#27500A">\u2713 No failures today!</div>`}
  <div style="padding:20px 28px">
    <div style="font-size:13px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Pipeline</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e4de">
      <thead><tr style="background:#f8f7f4"><th style="padding:8px 12px;text-align:left;font-size:11px;color:#888">Status</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#888">Count</th></tr></thead>
      <tbody>${statusRows}</tbody>
      <tfoot><tr style="background:#f8f7f4;border-top:2px solid #e5e4de"><td style="padding:8px 12px;font-weight:700">Total</td><td style="padding:8px 12px;font-weight:700;text-align:right">${stats.totalLeads}</td></tr></tfoot>
    </table>
  </div>
  ${topLeadRows ? `<div style="padding:0 28px 20px"><div style="font-size:13px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Top Leads</div><table style="width:100%;border-collapse:collapse;border:1px solid #e5e4de"><thead><tr style="background:#f8f7f4"><th style="padding:8px 12px;text-align:left;font-size:11px;color:#888">Name</th><th style="padding:8px 12px;text-align:left;font-size:11px;color:#888">Business</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#888">Score</th></tr></thead><tbody>${topLeadRows}</tbody></table></div>` : ""}
  <div style="background:#f8f7f4;padding:16px 28px;text-align:center;font-size:12px;color:#888;border-top:1px solid #e5e4de">${process.env.AGENCY_NAME||"WebPro Agency"} AI CRM</div>
</div></body></html>`;
}

async function sendReportNow(db) {
  console.log("[DailyReport] Manual trigger...");
  await sendDailyReport(db);
}

module.exports = { scheduleDailyReport, sendDailyReport, sendReportNow, buildStats };
