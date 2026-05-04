// types.js — JSDoc type definitions for IntelliSense
// Import nahi karo — sirf IDE aur AI tools ke liye
// Works with: VSCode, Cursor, Copilot, Claude, ChatGPT

/**
 * @typedef {Object} Lead
 * @property {string} id
 * @property {string} name
 * @property {string} business
 * @property {string} phone - 10 digits, no +91
 * @property {string} email
 * @property {string} [city]
 * @property {string} [notes]
 * @property {"google_sheet"|"chatbot"|"manual"} [source]
 * @property {"new"|"contacted"|"interested"|"meeting"|"closed"|"dnc"} status
 * @property {number} [score] - 0-100
 * @property {"HIGH"|"MEDIUM"|"LOW"} [priority]
 * @property {string[]} [scoreTags]
 * @property {number} [rowIndex] - Google Sheet row (1-based)
 * @property {string} [emailSent] - ISO timestamp
 * @property {"interested"|"not_interested"|"call_later"|"no_answer"|"error"} [callOutcome]
 * @property {Array<{role:string,text:string}>} [callTranscript]
 * @property {number} [callDuration] - seconds
 * @property {string} [recordingFile]
 * @property {string} [whatsappSent] - ISO timestamp
 * @property {string} [meetLink]
 * @property {string} [meetingTime] - ISO timestamp
 * @property {string} [lastContact]
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} DBInstance
 * @property {function(): DB} read - Always call fresh: const data = db.read()
 * @property {function(DB): void} write - Save: db.write(data)
 */

/**
 * @typedef {Object} DB
 * @property {Lead[]} leads
 * @property {Array} calls
 * @property {Array} emails
 * @property {Array} recordings
 * @property {Array} meetings
 * @property {Object} transcripts
 * @property {Array} failures
 * @property {Object} logs
 * @property {Array} scheduledFollowUps
 * @property {Array} reportsSent
 */

/**
 * @typedef {Object} GuardResult
 * @property {boolean} blocked
 * @property {string} [reason]
 * @property {"dnc"|"duplicate"} [type]
 */

/**
 * @typedef {Object} CallResult
 * @property {"interested"|"not_interested"|"call_later"|"no_answer"|"error"|"completed"} outcome
 * @property {string|null} recordingUrl
 * @property {Array} [transcript]
 */

/**
 * @typedef {Object} ScoreResult
 * @property {number} total - 0-100
 * @property {string[]} tags
 * @property {"HIGH"|"MEDIUM"|"LOW"} priority
 * @property {number} ruleScore
 */

/**
 * @typedef {Object} RetryResult
 * @property {boolean} success
 * @property {any} [result]
 * @property {number} attempts
 * @property {string} [error]
 */

module.exports = {};
