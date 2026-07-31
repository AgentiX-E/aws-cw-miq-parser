// Parser entry point: wraps the Peggy-generated parser with a typed public API.

import { parse as pegParse, SyntaxError as PegSyntaxError } from './generated/parser.js';
import type { ParsedQuery, ParseError, SourceLocation } from './types.js';
import {
  ErrorCodes,
  emptyInputError,
  inputTooLongError,
  createSyntaxError,
  createInternalError,
} from './errors.js';

export type { ParsedQuery, ParseError };
export type * from './types.js';
export { formatError, formatSourceSnippet, formatTerminalError } from './errors.js';
export { ErrorCodes } from './errors.js';

const MAX_QUERY_LENGTH = 4096;

/**
 * Parse a CloudWatch Metrics Insights query string into a structured JSON AST.
 *
 * @param input - The MIQ query string to parse (max 4096 characters per AWS limits).
 * @returns A typed ParsedQuery AST with full source locations on every node.
 * @throws {ParseError} If the query syntax is invalid, with location, code, and diagnostics.
 *
 * @example
 * ```ts
 * import { parse } from '@agentix-e/aws-cw-miq-parser';
 *
 * const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
 * console.log(result.select.function); // 'AVG'
 * ```
 */
export function parse(input: string): ParsedQuery {
  if (typeof input !== 'string') {
    throw new Error('parse(): input must be a string');
  }

  if (input.length === 0 || input.trim().length === 0) {
    throw emptyInputError();
  }

  if (input.length > MAX_QUERY_LENGTH) {
    throw inputTooLongError(input.length);
  }

  try {
    const result = pegParse(input, { startRule: 'Query' });
    return result as ParsedQuery;
  } catch (err) {
    if (err instanceof PegSyntaxError) {
      throw syntaxErrorFromPeggy(err);
    }
    throw createInternalError(
      `Unexpected error during parsing: ${(err as Error).message}`,
      { start: { offset: 0, line: 1, column: 1 }, end: { offset: input.length, line: 1, column: 1 } },
    );
  }
}

/** Convert a Peggy SyntaxError into our typed ParseError with diagnostic codes. */
function syntaxErrorFromPeggy(
  peggyErr: import('./generated/parser.js').PegSyntaxError,
): ParseError {
  const location: SourceLocation = {
    start: {
      line: peggyErr.location.start.line,
      column: peggyErr.location.start.column,
      offset: peggyErr.location.start.offset,
    },
    end: {
      line: peggyErr.location.end.line,
      column: peggyErr.location.end.column,
      offset: peggyErr.location.end.offset,
    },
  };

  // Classify the error for better diagnostics
  let code = ErrorCodes.SYN_UNEXPECTED_TOKEN as string;
  const msg = peggyErr.message.toLowerCase();

  if (msg.includes('select')) {
    code = ErrorCodes.SYN_MISSING_CLAUSE;
  } else if (
    msg.includes('avg') || msg.includes('count') || msg.includes('max') ||
    msg.includes('min') || msg.includes('sum')
  ) {
    code = ErrorCodes.SYN_INVALID_FUNCTION;
  }

  return createSyntaxError(
    peggyErr.message,
    location,
    code,
    peggyErr.expected?.map((e) => e.description),
    peggyErr.found ?? undefined,
  );
}
