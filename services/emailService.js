// services/emailService.js
// AI personalized Hinglish emails + follow-up sequences

const nodemailer = require("nodemailer");
const Anthropic  = require("@anthropic-ai/sdk");

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
});

async function generatePersonalizedEmail(lead, type = "cold") {
  const prompts = {
    cold: `Write a short cold email in Hinglish (Hindi+English) to ${lead.name} from ${lead.business} (${lead.city || "India"}).
Pitch: Professional website design from ${process.env.AGENCY_NAME || "WebPro Agency"}.
Include: personal greeting, one specific problem their business faces without a website, our solution (website + Google ranking + 1yr support), CTA for free 15-min Google Meet.
Format: SUBJECT: ...\nBODY: ...\nMax 120 words.`,
    followup: `Write a follow-up email in Hinglish to ${lead.name} from ${lead.business}.
We emailed 3 days ago about website design - no reply. Friendly reminder, not pushy.
Mention: limited slots this month, free demo still available.
Format: SUBJECT: ...\nBODY: ...\nMax 80 words.`,
    meeting_confirm: `Write a meeting confirmation email in Hinglish to ${lead.name}.
They agreed to a Google Meet demo for website design.
Format: SUBJECT: ...\nBODY: ...\nMax 60 words.`,
  };
  const msg = await ai.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [{ role: "user", content: prompts[type] || prompts.cold }],
  });
  const text    = msg.content[0].text;
  const subject = text.match(/SUBJECT:\s*(.+)/)?.[1]?.trim() || `Website ke baare mein - ${lead.business}`;
  const body    = text.split("BODY:")[1]?.trim() || text;
  return { subject, body };
}

async function sendEmail(lead, type = "cold") {
  try {
    const { subject, body } = await generatePersonalizedEmail(lead, type);
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <p style="font-size:15px;line-height:1.8">${body.replace(/\n/g, "<br>")}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
      <p style="font-size:12px;color:#888">${process.env.AGENCY_NAME || "WebPro Agency"} | ${process.env.AGENCY_PHONE || ""}</p>
    </div>`;
    await transporter.sendMail({
      from: `"${process.env.AGENCY_NAME || "WebPro Agency"}" <${process.env.SMTP_EMAIL}>`,
      to: lead.email, subject, html, text: body,
    });
    console.log(`[Email] Sent [${type}] to ${lead.name} (${lead.email})`);
    return { success: true, subject, type };
  } catch (err) {
    console.error(`[Email] Failed for ${lead.name}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendFollowUp(lead) { return sendEmail(lead, "followup"); }
async function sendMeetingConfirm(lead) { return sendEmail(lead, "meeting_confirm"); }

module.exports = { sendEmail, sendFollowUp, sendMeetingConfirm, generatePersonalizedEmail };
