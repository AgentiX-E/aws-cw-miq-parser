// Unit tests: error formatting and source snippet generation.

import { describe, it, expect, vi } from 'vitest';
import {
  formatSourceSnippet,
  formatError,
  formatTerminalError,
  ErrorCodes,
  emptyInputError,
  inputTooLongError,
  createInternalError,
  createSemanticError,
} from '../../source/errors.js';
import type { ParseError, SourceLocation } from '../../source/types.js';

const sampleErr: ParseError = {
  message: 'Expected one of AVG, COUNT, MAX, MIN, SUM but found FOO',
  location: {
    start: { offset: 7, line: 1, column: 8 },
    end: { offset: 10, line: 1, column: 11 },
  },
  code: 'SYN_INVALID_FUNCTION',
  type: 'syntax',
};

describe('formatSourceSnippet', () => {
  it('generates snippet with context', () => {
    const source = 'SELECT FOO(CPUUtilization) FROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 7, line: 1, column: 8 },
      end: { offset: 10, line: 1, column: 11 },
    };

    const snippet = formatSourceSnippet(source, location, 'Expected function name');
    expect(snippet).toContain('SELECT FOO');
    expect(snippet).toContain('^^^');
    expect(snippet).toContain('Expected function name');
    expect(snippet).toContain('1 |');
  });

  it('shows previous line for context', () => {
    const source = '-- My query\nSELECT FOO(x) FROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 20, line: 2, column: 8 },
      end: { offset: 23, line: 2, column: 11 },
    };

    const snippet = formatSourceSnippet(source, location, 'Bad function');
    expect(snippet).toContain('-- My query');
    expect(snippet).toContain('SELECT FOO');
  });

  it('handles single-character error highlight', () => {
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT';
    const location: SourceLocation = {
      start: { offset: 43, line: 1, column: 44 },
      end: { offset: 43, line: 1, column: 44 },
    };

    const snippet = formatSourceSnippet(source, location, 'Expected number after LIMIT');
    expect(snippet).toContain('^');
    expect(snippet.length).toBeGreaterThan(0);
  });
});

describe('formatError', () => {
  it('includes error type in output', () => {
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const output = formatError(source, sampleErr);
    expect(output).toContain('Syntax error');
    expect(output).toContain(sampleErr.message);
  });

  it('includes source snippet', () => {
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const output = formatError(source, sampleErr);
    expect(output).toContain('SELECT FOO');
    expect(output).toContain('^^^');
  });

  it('handles semantic errors', () => {
    const semErr: ParseError = {
      message: 'LIMIT value 0 is out of range',
      location: sampleErr.location,
      code: 'SEM_LIMIT_OUT_OF_RANGE',
      type: 'semantic',
    };
    const source = 'SELECT AVG(x) FROM "AWS/EC2" LIMIT 0';
    const output = formatError(source, semErr);
    expect(output).toContain('Semantic error');
    expect(output).toContain('LIMIT value 0');
  });

  it('handles internal errors', () => {
    const intErr: ParseError = {
      message: 'Unexpected runtime error',
      location: sampleErr.location,
      code: ErrorCodes.INT_UNEXPECTED,
      type: 'internal',
    };
    const source = 'SELECT AVG(x) FROM "AWS/EC2"';
    const output = formatError(source, intErr);
    expect(output).toContain('Internal error');
  });
});

describe('error factory functions', () => {
  it('emptyInputError has correct code and type', () => {
    const err = emptyInputError();
    expect(err.code).toBe(ErrorCodes.SYN_EMPTY_INPUT);
    expect(err.type).toBe('syntax');
  });

  it('inputTooLongError includes the length', () => {
    const err = inputTooLongError(5000);
    expect(err.message).toContain('5000');
    expect(err.code).toBe(ErrorCodes.SYN_INPUT_TOO_LONG);
  });

  it('createInternalError has internal type', () => {
    const loc: SourceLocation = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
    const err = createInternalError('Test', loc);
    expect(err.type).toBe('internal');
    expect(err.code).toBe(ErrorCodes.INT_UNEXPECTED);
  });

  it('createSemanticError has semantic type', () => {
    const loc: SourceLocation = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
    const err = createSemanticError('Test', loc, 'SEM_TEST');
    expect(err.type).toBe('semantic');
  });
});

describe('formatTerminalError', () => {
  it('returns colored output string', async () => {
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, sampleErr);
    expect(output).toContain(sampleErr.code);
    expect(output).toContain('SELECT FOO');
    expect(output.length).toBeGreaterThan(100);
  });
});
