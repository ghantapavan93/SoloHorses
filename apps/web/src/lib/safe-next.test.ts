import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext: where a sign-in may send a person', () => {
  it('keeps an in-app path, with a percent-encoded query and a hash', () => {
    expect(safeNext('/today')).toBe('/today');
    expect(safeNext('/money?focus=INV-26-0012')).toBe('/money?focus=INV-26-0012');
    expect(safeNext('/money?ask=Why%20are%20the%20papers%20for%20LOT-26-0041%20held%3F')).toBe(
      '/money?ask=Why%20are%20the%20papers%20for%20LOT-26-0041%20held%3F',
    );
    expect(safeNext('/settlement#returns')).toBe('/settlement#returns');
  });

  it('falls back to the day sheet for anything that could leave the app or carry raw text', () => {
    for (const bad of [
      '//evil.example',
      'https://evil.example/today',
      'javascript:alert(1)',
      '/money?ask=Why are the papers held?',
      '/money?<script>',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad)).toBe('/today');
    }
  });
});
