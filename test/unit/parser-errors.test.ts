// Unit tests: non-Peggy error wrapping in parser's catch handler.
// This test uses module mocking to trigger the defense-in-depth error path.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../source/generated/parser.js', () => ({
  parse: () => { throw new TypeError('Mock parser failure'); },
  SyntaxError: class extends Error {
    constructor() { super('Mock'); }
    get expected() { return []; }
    get found() { return null; }
    get location() { return { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } }; }
  },
}));

// Import after mock is registered
import { parse } from '../../source/parser.js';

describe('parse — non-Peggy error handling', () => {
  it('wraps non-Peggy errors with location context', () => {
    try {
      parse('SELECT AVG(x) FROM "AWS/EC2"');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('Unexpected error');
      expect(err.message).toContain('Mock parser failure');
      expect(err.location).toBeDefined();
      expect(err.location.start.line).toBe(1);
    }
  });
});
