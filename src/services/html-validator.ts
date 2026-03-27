export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateHtml(content: Buffer, maxSize: number): ValidationResult {
  const errors: string[] = [];

  // Check empty buffer first — short-circuit
  if (content.length === 0) {
    return { valid: false, errors: ['Content is empty'] };
  }

  // Check file size against maxSize
  if (content.length > maxSize) {
    errors.push(`Content size (${content.length} bytes) exceeds maximum allowed size (${maxSize} bytes)`);
  }

  // UTF-8 check
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    errors.push('Content is not valid UTF-8');
    return { valid: false, errors };
  }

  // Check for <!doctype html or <html (case-insensitive)
  const lower = decoded.toLowerCase();
  const hasDoctype = lower.includes('<!doctype html');
  const hasHtmlTag = lower.includes('<html');

  if (!hasDoctype && !hasHtmlTag) {
    errors.push('Content does not contain a <!doctype html> declaration or <html> tag');
  }

  return { valid: errors.length === 0, errors };
}
