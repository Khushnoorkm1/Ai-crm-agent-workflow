// services/sheetUpdateService.js
// CRM se Google Sheet mein data wapas likhta hai
// Call response, recording URL, status, meeting link — sab kuch
// Uses Google Sheet Web App (Apps Script deployed as Web App)

const SHEET_WEBAPP_URL = process.env.GOOGLE_SHEET_WEBAPP_URL;

async function updateGoogleSheet(rowIndex, updates) {
  if (!rowIndex || !SHEET_WEBAPP_URL) {
    console.log(`[Sheet] Skip update row ${rowIndex} — no webapp URL configured`);
    return;
  }
  try {
    const response = await fetch(SHEET_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowIndex, updates }),
    });
    const result = await response.json();
    if (result.success) console.log(`[Sheet] Row ${rowIndex} updated:`, Object.keys(updates).join(", "));
    else console.error(`[Sheet] Update failed:`, result.error);
  } catch (err) {
    console.error(`[Sheet] Update error:`, err.message);
  }
}

async function bulkUpdateSheet(updates) {
  for (const item of updates) {
    await updateGoogleSheet(item.rowIndex, item.updates);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function appendRowToSheet(leadData) {
  if (!SHEET_WEBAPP_URL) return;
  try {
    await fetch(SHEET_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "append", data: leadData }),
    });
  } catch (err) {
    console.error("[Sheet] Append error:", err.message);
  }
}

async function readLeadsFromSheet() {
  if (!SHEET_WEBAPP_URL) return [];
  try {
    const resp = await fetch(SHEET_WEBAPP_URL + "?action=read");
    const result = await resp.json();
    return result.leads || [];
  } catch (err) {
    console.error("[Sheet] Read error:", err.message);
    return [];
  }
}

module.exports = { updateGoogleSheet, bulkUpdateSheet, appendRowToSheet, readLeadsFromSheet };
