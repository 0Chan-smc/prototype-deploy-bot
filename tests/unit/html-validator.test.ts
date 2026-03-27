import { describe, it, expect } from 'vitest';
import { validateHtml } from '../../src/services/html-validator.js';

describe('validateHtml', () => {
  it('should return valid for proper HTML with doctype and html tag', () => {
    const content = Buffer.from('<!doctype html><html><body>Hello</body></html>');
    const result = validateHtml(content, 1024);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('should return valid for HTML with <html tag but no doctype', () => {
    const content = Buffer.from('<html><body>Hello</body></html>');
    const result = validateHtml(content, 1024);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('should return invalid for empty buffer', () => {
    const content = Buffer.alloc(0);
    const result = validateHtml(content, 1024);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should return invalid when buffer exceeds maxSize', () => {
    const content = Buffer.from('<!doctype html><html><body>Hello</body></html>');
    const result = validateHtml(content, 10);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('size'))).toBe(true);
  });

  it('should return invalid for non-UTF-8 content', () => {
    const content = Buffer.from([0xff, 0xfe, 0x00, 0x48]);
    const result = validateHtml(content, 1024);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('utf-8') || e.toLowerCase().includes('utf8'))).toBe(true);
  });

  it('should return invalid for plain text without doctype or <html tag', () => {
    const content = Buffer.from('Hello, this is just plain text.');
    const result = validateHtml(content, 1024);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('doctype') || e.toLowerCase().includes('html'))).toBe(true);
  });

  it('should be case insensitive: <!DOCTYPE HTML> is valid', () => {
    const content = Buffer.from('<!DOCTYPE HTML><html><body>Hi</body></html>');
    const result = validateHtml(content, 1024);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('should be case insensitive: <!doctype html> (lowercase) is valid', () => {
    const content = Buffer.from('<!doctype html><html><body>Hi</body></html>');
    const result = validateHtml(content, 1024);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
