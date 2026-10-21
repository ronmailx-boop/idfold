// Rough password strength estimate (no dictionary library). Score 0-4.
export const MIN_PASSWORD_LENGTH = 10;
export const MIN_SCORE = 2;

const LABELS = ['חלשה מאוד', 'חלשה', 'בינונית', 'חזקה', 'חזקה מאוד'];
const COMMON = /password|passw0rd|qwerty|asdf|zxcv|letmein|admin|welcome|iloveyou|1234|abcd|0000|1111|סיסמה|סיסמא/i;

function isSequence(s) {
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    run = d === 1 || d === -1 || d === 0 ? run + 1 : 1;
    if (run >= 4) return true;
  }
  return false;
}

export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[֐-׿]/.test(pw)) pool += 27;
  if (/[^a-zA-Z0-9֐-׿]/.test(pw)) pool += 33;
  const chars = [...pw];
  const effectiveLength = Math.min(chars.length, new Set(chars).size * 2);
  let bits = effectiveLength * Math.log2(Math.max(pool, 2));
  if (COMMON.test(pw)) bits -= 20;
  if (isSequence(pw)) bits -= 10;
  const score = bits < 30 ? 0 : bits < 42 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: LABELS[score] };
}
