/**
 * Normalize filename to NFC (Normalized Form Composed) and sanitize Unicode spaces
 * to ensure consistent representation across different systems, especially macOS which
 * can use NFD (Normalized Form Decomposed) and Unicode spaces in timestamps.
 *
 * @param filename The filename to normalize
 * @returns The filename normalized to NFC form with Unicode spaces converted to regular spaces
 */
export const normalizeFilenameToNFC = (filename: string): string => {
  try {
    // First normalize to NFC (Normalized Form Composed)
    let normalized = filename.normalize('NFC');

    // Replace problematic Unicode spaces with regular ASCII spaces
    // This fixes the common macOS issue where screenshots have Unicode spaces before PM/AM
    const unicodeSpaces = [
      '\u00A0', // Non-breaking space
      '\u2000', // En quad
      '\u2001', // Em quad
      '\u2002', // En space
      '\u2003', // Em space
      '\u2004', // Three-per-em space
      '\u2005', // Four-per-em space
      '\u2006', // Six-per-em space
      '\u2007', // Figure space
      '\u2008', // Punctuation space
      '\u2009', // Thin space
      '\u200A', // Hair space
      '\u202F', // Narrow no-break space (common in macOS screenshots)
      '\u205F', // Medium mathematical space
      '\u3000', // Ideographic space
    ];

    // Replace all Unicode spaces with regular ASCII space
    for (const unicodeSpace of unicodeSpaces) {
      normalized = normalized.replaceAll(unicodeSpace, ' ');
    }

    return normalized;
  } catch (error) {
    console.warn('Failed to normalize filename to NFC:', filename, error);
    return filename;
  }
};

/**
 * Normalize file path to NFC (Normalized Form Composed) to ensure consistent
 * Unicode representation across different systems.
 *
 * @param path The file path to normalize
 * @returns The path with all components normalized to NFC form
 */
export const normalizePathToNFC = (path: string): string => {
  try {
    // Normalize to NFC (Normalized Form Composed)
    return path.normalize('NFC');
  } catch (error) {
    console.warn('Failed to normalize path to NFC:', path, error);
    return path;
  }
};

/**
 * Detect text direction (RTL/LTR) based on the first strong-directional character.
 *
 * RTL ranges:
 *   - Hebrew:        U+0590–U+05FF
 *   - Arabic:        U+0600–U+06FF
 *   - Syriac:        U+0700–U+074F
 *   - Arabic Supplement: U+0750–U+077F
 *   - Arabic Presentation Forms-A: U+FB50–U+FDFF
 *   - Arabic Presentation Forms-B: U+FE70–U+FEFF
 *
 * LTR ranges (strong):
 *   - Basic Latin letters: A-Z, a-z
 *
 * Everything else (digits, punctuation, whitespace, CJK) is "weak" / "neutral"
 * and doesn't determine direction by itself.
 *
 * @param text The text to inspect
 * @returns 'rtl' if the first strong character is RTL, 'ltr' otherwise
 */
export const detectTextDirection = (text: string | null | undefined): 'rtl' | 'ltr' => {
  if (!text) return 'ltr';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    // RTL ranges
    if (
      (code >= 0x0590 && code <= 0x05ff) || // Hebrew
      (code >= 0x0600 && code <= 0x06ff) || // Arabic
      (code >= 0x0700 && code <= 0x074f) || // Syriac
      (code >= 0x0750 && code <= 0x077f) || // Arabic Supplement
      (code >= 0x08a0 && code <= 0x08ff) || // Arabic Extended-A
      (code >= 0xfb1d && code <= 0xfdff) || // Hebrew + Arabic Presentation Forms-A
      (code >= 0xfe70 && code <= 0xfeff)    // Arabic Presentation Forms-B
    ) {
      return 'rtl';
    }
    // LTR strong characters (basic Latin letters)
    if (
      (code >= 0x0041 && code <= 0x005a) || // A-Z
      (code >= 0x0061 && code <= 0x007a)    // a-z
    ) {
      return 'ltr';
    }
  }
  return 'ltr'; // default to LTR when no strong char found
};
