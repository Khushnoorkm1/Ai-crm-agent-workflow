// services/leadScoringService.js
// AI + rule-based lead scoring 0-100
// Business type + city tier + notes keywords

const Anthropic = require("@anthropic-ai/sdk");
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function ruleBasedScore(lead) {
  let score = 50;
  const tags = [];
  const biz   = (lead.business || "").toLowerCase();
  const notes = (lead.notes    || "").toLowerCase();
  const city  = (lead.city     || "").toLowerCase();

  const highValue = ["restaurant","hotel","boutique","salon","clinic","hospital","school","academy","gym","spa","jewel","jewelry"];
  const midValue  = ["shop","store","mart","electronics","pharmacy","medical","travel","tours"];
  const lowValue  = ["kirana","general","misc","other"];

  if (highValue.some(k => biz.includes(k)))     { score += 25; tags.push("High-value business"); }
  else if (midValue.some(k => biz.includes(k))) { score += 10; tags.push("Mid-value business"); }
  else if (lowValue.some(k => biz.includes(k))) { score -= 10; tags.push("Low-margin business"); }

  const tier1 = ["mumbai","delhi","bangalore","bengaluru","hyderabad","chennai","pune","kolkata"];
  const tier2 = ["jaipur","ahmedabad","surat","lucknow","chandigarh","indore","kochi","bhopal"];
  if (tier1.some(c => city.includes(c)))        { score += 15; tags.push("Metro city"); }
  else if (tier2.some(c => city.includes(c)))   { score += 8;  tags.push("Tier-2 city"); }

  if (notes.includes("interested"))             { score += 20; tags.push("Already interested"); }
  if (notes.includes("website"))                { score += 15; tags.push("Mentioned website"); }
  if (notes.includes("no budget") || notes.includes("nahi")) { score -= 20; tags.push("Budget concern"); }

  if (lead.email && lead.email.includes("@") && !lead.email.includes("gmail")) {
    score += 10; tags.push("Business email");
  }

  return { score: Math.min(100, Math.max(0, score)), tags };
}

async function generateLeadScore(lead) {
  const { score: ruleScore, tags: ruleTags } = ruleBasedScore(lead);
  try {
    const msg = await ai.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Score this lead for website design services (India market).
Lead: Name: ${lead.name}, Business: ${lead.business}, City: ${lead.city || "?"}, Notes: ${lead.notes || "none"}
Rule score so far: ${ruleScore}/100

Respond with JSON only:
{"adjustment": <number -20 to +20>, "reason": "<one short reason>", "priority": "<HIGH/MEDIUM/LOW>"}`,
      }],
    });
    const text = msg.content[0].text.trim();
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const finalScore = Math.min(100, Math.max(0, ruleScore + (json.adjustment || 0)));
    return {
      total: finalScore,
      tags: [...ruleTags, json.reason].filter(Boolean),
      priority: json.priority || (finalScore >= 70 ? "HIGH" : finalScore >= 40 ? "MEDIUM" : "LOW"),
      ruleScore,
    };
  } catch {
    return {
      total: ruleScore,
      tags: ruleTags,
      priority: ruleScore >= 70 ? "HIGH" : ruleScore >= 40 ? "MEDIUM" : "LOW",
      ruleScore,
    };
  }
}

function rankLeads(leads) {
  return [...leads].sort((a, b) => (b.score || 0) - (a.score || 0));
}

module.exports = { generateLeadScore, ruleBasedScore, rankLeads };
