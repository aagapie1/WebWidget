/**
 * Replaces personal data with placeholders before anything is stored or logged (CLAUDE.md
 * rule 7, ADR 005): e-mail addresses, Romanian CNPs (13 digits) and phone numbers.
 * Deliberately aggressive: a false positive only hides a number, a false negative leaks data.
 */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const CNP = /(?<!\d)[1-9]\d{12}(?!\d)/g;
// 9+ digits, optionally with +/00 prefix and spaces, dots, dashes or parentheses between them.
const PHONE = /(?:\+|00)?\(?\d(?:[\s().-]*\d){8,}/g;

export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, '[email]').replace(CNP, '[CNP]').replace(PHONE, '[telefon]');
}
