// Unit tests: error formatting and source snippet generation.
// Comprehensive coverage of all branches including terminal formatting edge cases.

import { describe, it, expect } from 'vitest';
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

const multiLineErr: ParseError = {
  message: 'Expected identifier but got 123',
  location: {
    start: { offset: 21, line: 3, column: 6 },
    end: { offset: 24, line: 3, column: 9 },
  },
  code: 'SYN_UNEXPECTED_TOKEN',
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

  it('handles error on line 3 of multi-line query', () => {
    const source = '/* comment */\n-- another\nSELECT FOO(x) FROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 24, line: 3, column: 8 },
      end: { offset: 27, line: 3, column: 11 },
    };

    const snippet = formatSourceSnippet(source, location, 'Bad function on line 3');
    expect(snippet).toContain('-- another');
    expect(snippet).toContain('SELECT FOO');
    expect(snippet).toContain('2 |');
    expect(snippet).toContain('3 |');
  });

  it('handles error spanning to end of line via location.end.line fallback', () => {
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 0, line: 1, column: 1 },
      // end line 1 → uses end.column; but end.line may be undefined (testing the || fallback)
      end: { offset: 6, line: 1, column: 7 },
    };

    const snippet = formatSourceSnippet(source, location, 'Test');
    expect(snippet).toContain('SELECT');
    expect(snippet).toContain('^^^^^^');
  });

  it('uses colorize parameter (forward-compatible)', () => {
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 7, line: 1, column: 8 },
      end: { offset: 10, line: 1, column: 11 },
    };

    const snippet = formatSourceSnippet(source, location, 'Test', true);
    expect(snippet).toContain('SELECT FOO');
    const nocolor = formatSourceSnippet(source, location, 'Test', false);
    expect(snippet).toEqual(nocolor);
  });

  it('handles error spanning multiple lines (end.line differs from start.line)', () => {
    const source = 'SELECT AVG(CPUUtilization)\nFROM "AWS/EC2"';
    const location: SourceLocation = {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 42, line: 2, column: 14 },
    };

    const snippet = formatSourceSnippet(source, location, 'Multi-line error');
    expect(snippet).toContain('1 |');
    expect(snippet).toContain('SELECT');
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

  it('formats multi-line source error', () => {
    const source = '-- header\n-- comment\nSELECT FOO(x) FROM "AWS/EC2"';
    const output = formatError(source, multiLineErr);
    expect(output).toContain('SELECT FOO');
    expect(output).toContain('Syntax error');
  });
});

describe('error factory functions', () => {
  it('emptyInputError has correct code and type', () => {
    const err = emptyInputError();
    expect(err.code).toBe(ErrorCodes.SYN_EMPTY_INPUT);
    expect(err.type).toBe('syntax');
    expect(err.location.start.line).toBe(1);
    expect(err.location.start.column).toBe(1);
  });

  it('inputTooLongError includes the length and end position', () => {
    const err = inputTooLongError(5000);
    expect(err.message).toContain('5000');
    expect(err.code).toBe(ErrorCodes.SYN_INPUT_TOO_LONG);
    expect(err.location.end.column).toBe(5001);
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
  it('returns colored output for syntax error', async () => {
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, sampleErr);
    expect(output).toContain(sampleErr.code);
    expect(output).toContain('SELECT FOO');
    expect(output.length).toBeGreaterThan(100);
  });

  it('handles semantic error type label', async () => {
    const semErr: ParseError = {
      message: 'LIMIT value 0 is out of range',
      location: sampleErr.location,
      code: 'SEM_LIMIT_OUT_OF_RANGE',
      type: 'semantic',
    };
    const source = 'SELECT AVG(x) FROM "AWS/EC2" LIMIT 0';
    const output = await formatTerminalError(source, semErr);
    expect(output).toContain('Semantic error');
    expect(output).toContain('LIMIT');
  });

  it('handles internal error type label', async () => {
    const intErr: ParseError = {
      message: 'Unexpected runtime error',
      location: sampleErr.location,
      code: ErrorCodes.INT_UNEXPECTED,
      type: 'internal',
    };
    const source = 'SELECT AVG(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, intErr);
    expect(output).toContain('Internal error');
  });

  it('shows previous line context for multi-line source', async () => {
    const source = '-- comment\n-- another\nSELECT FOO(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, multiLineErr);
    expect(output).toContain('-- another');
    expect(output).toContain('SELECT FOO');
  });

  it('shows expected tokens when available', async () => {
    const errWithExpected: ParseError = {
      message: 'Expected identifier but got 123',
      location: {
        start: { offset: 7, line: 1, column: 8 },
        end: { offset: 10, line: 1, column: 11 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: ['AVG', 'COUNT', 'MAX', 'MIN', 'SUM'],
    };
    const source = 'SELECT 123(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, errWithExpected);
    expect(output).toContain('expected');
    expect(output).toContain('AVG');
  });

  it('shows "and N more" for 6+ expected tokens', async () => {
    const errWithMany: ParseError = {
      message: 'Expected something',
      location: {
        start: { offset: 7, line: 1, column: 8 },
        end: { offset: 10, line: 1, column: 11 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    };
    const source = 'SELECT ? FROM "AWS/EC2"';
    const output = await formatTerminalError(source, errWithMany);
    expect(output).toContain('and 2 more');
  });

  it('works without expected tokens', async () => {
    const errNoExpected: ParseError = {
      message: 'Generic syntax error',
      location: sampleErr.location,
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: undefined,
    };
    const source = 'SELECT FOO(x) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, errNoExpected);
    expect(output).toBeTruthy();
    expect(output).not.toContain('expected');
  });

  it('works with empty expected array', async () => {
    const errEmptyExpected: ParseError = {
      message: 'Error at start',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 0, line: 1, column: 1 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: [],
    };
    const source = ' ';
    const output = await formatTerminalError(source, errEmptyExpected);
    expect(output).toBeTruthy();
    expect(output).not.toContain('help:');
  });

  it('handles cross-line error span', async () => {
    const crossLineErr: ParseError = {
      message: 'Syntax error spanning lines',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 42, line: 2, column: 14 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
    };
    const source = 'SELECT AVG(CPUUtilization)\nFROM "AWS/EC2"';
    const output = await formatTerminalError(source, crossLineErr);
    expect(output).toContain('Syntax error');
    expect(output).toContain('SELECT');
  });
});

describe('formatTerminalError — error types', () => {
  it('formats semantic errors with correct label', async () => {
    const semanticErr: ParseError = {
      message: 'LIMIT out of range',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 10, line: 1, column: 11 },
      },
      code: 'SEM_LIMIT_OUT_OF_RANGE',
      type: 'semantic',
    };
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, semanticErr);
    expect(output).toContain('Semantic error');
    expect(output).toContain('LIMIT out of range');
  });

  it('formats internal errors with correct label', async () => {
    const internalErr: ParseError = {
      message: 'Unexpected parsing failure',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 10, line: 1, column: 11 },
      },
      code: 'INT_UNEXPECTED',
      type: 'internal',
    };
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, internalErr);
    expect(output).toContain('Internal error');
  });

  it('formatTerminalError includes expected tokens when available', async () => {
    const errWithExpected: ParseError = {
      message: 'Unexpected token',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 5, line: 1, column: 6 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: ['FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT'],
    };
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, errWithExpected);
    expect(output).toContain('expected');
    expect(output).toContain('FROM');
    expect(output).not.toContain('and 0 more');
  });

  it('formatTerminalError truncates long expected token lists', async () => {
    const errWithMany: ParseError = {
      message: 'Unexpected token',
      location: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 5, line: 1, column: 6 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
      expected: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], // 8 items
    };
    const source = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const output = await formatTerminalError(source, errWithMany);
    expect(output).toContain('and 3 more');
  });

  it('formatSourceSnippet shows previous line context for line > 1', () => {
    const err: ParseError = {
      message: 'Error on line 2',
      location: {
        start: { offset: 28, line: 2, column: 1 },
        end: { offset: 32, line: 2, column: 5 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
    };
    const source = 'SELECT AVG(CPUUtilization)\nFROM "AWS/EC2"';
    const output = formatSourceSnippet(source, err.location, err.message);
    expect(output).toContain('SELECT'); // previous line shown
    expect(output).toContain('FROM');    // error line shown
  });

  it('formatTerminalError handles error on second line', async () => {
    const err: ParseError = {
      message: 'Invalid FROM',
      location: {
        start: { offset: 28, line: 2, column: 1 },
        end: { offset: 32, line: 2, column: 5 },
      },
      code: 'SYN_UNEXPECTED_TOKEN',
      type: 'syntax',
    };
    const source = 'SELECT AVG(CPUUtilization)\nFROM "AWS/EC2"';
    const output = await formatTerminalError(source, err);
    expect(output).toContain('Syntax error');
  });
});
