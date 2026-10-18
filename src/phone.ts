/** Phone numbers in, WhatsApp jids out. */

/**
 * A phone number as WhatsApp spells it: digits with the country code, then @s.whatsapp.net.
 * Accepts a jid, an international number (+972 52-421-9320, 00972...), or a national one, where a
 * leading 0 is a trunk prefix that `defaultCc` replaces. Returns null when it can't tell.
 */
export function toJid(raw: string, defaultCc?: string): string | null {
  const text = (raw ?? '').trim();
  if (/@s\.whatsapp\.net$/.test(text)) return text;
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (!text.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (!defaultCc) return null;                            // can't tell the country, so don't guess
    else if (digits.startsWith('0')) digits = defaultCc + digits.slice(1);
    else if (digits.length <= 10) digits = defaultCc + digits;   // national number without the trunk 0
  }
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : null;
}
