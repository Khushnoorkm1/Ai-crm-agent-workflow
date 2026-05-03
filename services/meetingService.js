// services/meetingService.js
// Google Calendar API se auto Google Meet + SMS + email confirm

const { google }         = require("googleapis");
const { sendMeetingConfirm } = require("./emailService");

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback"
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

async function scheduleGoogleMeet(lead, preferredDate = null) {
  try {
    const calendar = google.calendar({ version: "v3", auth: getAuth() });
    const start = preferredDate ? new Date(preferredDate) : (() => {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return d;
    })();
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const event = {
      summary:     `Website Demo — ${lead.business}`,
      description: `Free 15-min website design consultation for ${lead.name} (${lead.business}).\n\n${process.env.AGENCY_NAME} | ${process.env.AGENCY_PHONE}`,
      start: { dateTime: start.toISOString(), timeZone: "Asia/Kolkata" },
      end:   { dateTime: end.toISOString(),   timeZone: "Asia/Kolkata" },
      attendees: [{ email: lead.email, displayName: lead.name }, { email: process.env.SMTP_EMAIL }],
      conferenceData: { createRequest: { requestId: `meet-${lead.id}-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 30 }] },
    };
    const created  = await calendar.events.insert({ calendarId: "primary", resource: event, conferenceDataVersion: 1, sendUpdates: "all" });
    const meetLink = created.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri;
    console.log(`[Meet] Scheduled for ${lead.name}: ${meetLink}`);
    return { success: true, meetLink, eventId: created.data.id, startTime: start.toISOString() };
  } catch (err) {
    console.error(`[Meet] Failed for ${lead.name}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function autoScheduleForInterestedLead(lead, db) {
  const result = await scheduleGoogleMeet(lead);
  if (!result.success) return result;

  const data = db.read();
  const l    = data.leads.find(x => x.id === lead.id);
  if (l) { l.status = "meeting"; l.meetLink = result.meetLink; l.meetingTime = result.startTime; l.lastContact = new Date().toLocaleDateString("hi-IN"); }
  if (!data.meetings) data.meetings = [];
  data.meetings.push({ leadId: lead.id, leadName: lead.name, meetLink: result.meetLink, startTime: result.startTime, scheduledAt: new Date().toISOString() });
  db.write(data);

  await sendMeetingConfirm({ ...lead, meetLink: result.meetLink });

  try {
    const twilio = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const dateStr = new Date(result.startTime).toLocaleString("hi-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    await twilio.messages.create({
      body: `Namaste ${lead.name}! Meeting confirm ho gayi.\nDate: ${dateStr}\nMeet link: ${result.meetLink}\n— ${process.env.AGENCY_NAME}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   "+91" + lead.phone.replace(/\D/g,"").slice(-10),
    });
  } catch (e) { console.error("[Meet] SMS failed:", e.message); }

  return result;
}

async function getAuthUrl() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  return auth.generateAuthUrl({ access_type: "offline", scope: ["https://www.googleapis.com/auth/calendar"] });
}

async function getTokensFromCode(code) {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  const { tokens } = await auth.getToken(code);
  console.log("Save GOOGLE_REFRESH_TOKEN:", tokens.refresh_token);
  return tokens;
}

module.exports = { scheduleGoogleMeet, autoScheduleForInterestedLead, getAuthUrl, getTokensFromCode };
