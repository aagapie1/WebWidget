const graphemes = new Intl.Segmenter('ro', { granularity: 'grapheme' });

/**
 * The assistant's initials avatar: "Asistentul Primăriei" → "AP"; one word → its first letter.
 * Shared by the gateway (widget-config) and the admin form, so both always show the same letters.
 */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => {
      // Graphemes, not code units: "Ștefan" → "Ș".
      for (const { segment } of graphemes.segment(word)) {
        if (/\p{L}|\p{N}/u.test(segment)) return segment;
      }
      return undefined;
    })
    .filter((char): char is string => char !== undefined)
    .slice(0, 2);
  return (letters.join('') || '?').toLocaleUpperCase('ro');
}
