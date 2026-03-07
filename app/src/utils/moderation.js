// Content moderation scanner for DuelStake
// Scans text for phone numbers, emails, profanity, threats

const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{2,4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Threat/harassment patterns
const THREAT_PATTERNS = [
  /\bi['']?ll\s+(kill|find|hurt|destroy|end)\s+(you|u)\b/i,
  /\b(kill|murder|stab|shoot)\s+(you|u|yourself|urself)\b/i,
  /\b(gonna|going\s+to)\s+(die|kill|find|hurt)\b/i,
  /\b(find\s+(you|u)\s*(and|&))\b/i,
  /\bfind\s+where\s+(you|u)\s+live\b/i,
  /\b(death\s+threat|i\s+know\s+where\s+you\s+live)\b/i,
  /\b(kys|kill\s+yourself|neck\s+yourself)\b/i,
  /\b(hope\s+you\s+die|wish\s+you\s+were\s+dead)\b/i,
  /\b(swat|doxx?|dox)\s+(you|u|him|her|them)\b/i,
  /\byou('re|\s+are)\s+(dead|done)\b/i,
];

// Profanity wordlist - actual slurs get flagged, gaming toxicity tracked as informational
const SLURS = [
  // EN slurs
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'piss', 'bastard',
  'whore', 'slut', 'faggot', 'fag', 'retard', 'nigger', 'nigga',
  // IT profanity
  'cazzo', 'merda', 'puttana', 'stronzo', 'stronza', 'vaffanculo', 'minchia',
  'coglione', 'troia', 'porco dio', 'madonna',
  // DE profanity
  'scheiße', 'scheisse', 'arschloch', 'hurensohn', 'wichser', 'fotze', 'missgeburt',
  'spasti', 'behindert',
];

// Gaming toxicity - informational, not auto-ban
const GAMING_TOXICITY = [
  'noob', 'hacker', 'cheater', 'trash', 'garbage', 'bot', 'gg ez',
  'uninstall', 'dogwater', 'rat', 'boosted',
];

/**
 * Scan text content for policy violations
 * @param {string} text
 * @returns {{ clean: boolean, flags: Array<{type: string, detail: string}> }}
 */
export function scanContent(text) {
  if (!text || typeof text !== 'string') {
    return { clean: true, flags: [] };
  }

  const flags = [];
  const lower = text.toLowerCase();

  // Phone numbers
  const phones = text.match(PHONE_RE);
  if (phones) {
    for (const phone of phones) {
      // Filter out short numbers that are likely just regular numbers (scores, etc.)
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 8) {
        flags.push({ type: 'auto_phone', detail: `Phone number detected: ${phone}` });
      }
    }
  }

  // Email addresses
  const emails = text.match(EMAIL_RE);
  if (emails) {
    for (const email of emails) {
      flags.push({ type: 'auto_email', detail: `Email detected: ${email}` });
    }
  }

  // Threats
  for (const pattern of THREAT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      flags.push({ type: 'auto_threat', detail: `Threat/harassment: "${match[0]}"` });
    }
  }

  // Profanity (slurs)
  for (const word of SLURS) {
    // Word boundary check for single words, includes check for multi-word
    if (word.includes(' ')) {
      if (lower.includes(word)) {
        flags.push({ type: 'auto_profanity', detail: `Profanity: "${word}"` });
      }
    } else {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) {
        flags.push({ type: 'auto_profanity', detail: `Profanity: "${word}"` });
      }
    }
  }

  // Gaming toxicity (informational)
  for (const word of GAMING_TOXICITY) {
    if (word.includes(' ')) {
      if (lower.includes(word)) {
        flags.push({ type: 'auto_toxicity', detail: `Gaming toxicity: "${word}"` });
      }
    } else {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) {
        flags.push({ type: 'auto_toxicity', detail: `Gaming toxicity: "${word}"` });
      }
    }
  }

  return {
    clean: flags.length === 0,
    flags,
  };
}
