// Parser entry point: wraps the Peggy-generated parser with a typed public API.

import { parse as pegParse, SyntaxError as PegSyntaxError } from './generated/parser.js';
import type { ParsedQuery, ParseError } from './types.js';

/**
 * Parse a CloudWatch Metrics Insights query string into a structured JSON AST.
 *
 * @param input - The MIQ query string to parse (max 4096 characters per AWS limits).
 * @returns A typed ParsedQuery AST with full source locations on every node.
 * @throws {ParseError} If the query syntax is invalid, with location and expected tokens.
 *
 * @example
 * ```ts
 * import { parse } from '@agentix/aws-cw-miq-parser';
 *
 * const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
 * console.log(result.select.function); // 'AVG'
 * console.log(result.from.namespace);  // 'AWS/EC2'
 * ```
 */
export function parse(input: string): ParsedQuery {
  if (typeof input !== 'string') {
    throw new Error('parse(): input must be a string');
  }

  if (input.length === 0 || input.trim().length === 0) {
    throw createParseError('Empty query string — expected a Metrics Insights query', {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    });
  }

  // AWS limit: 4096 characters
  if (input.length > 4096) {
    throw createParseError(
      `Query exceeds maximum length of 4096 characters (got ${input.length})`,
      {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: input.length, line: 1, column: input.length + 1 },
      }
    );
  }

  try {
    const result = pegParse(input, { startRule: 'Query' });
    return result as ParsedQuery;
  } catch (err) {
    // The generated Peggy parser always throws PegSyntaxError on syntax errors.
    // We enrich it with our typed error structure for consistent error handling.
    if (err instanceof PegSyntaxError) {
      throw createParseError(
        err.message,
        err.location,
        err.expected?.map((e) => e.description),
        err.found ?? undefined
      );
    }
    throw createParseError(
      `Unexpected error during parsing: ${(err as Error).message}`,
      { start: { offset: 0, line: 1, column: 1 }, end: { offset: input.length, line: 1, column: input.length + 1 } }
    );
  }
}

/** Convert a Peggy SyntaxError into our typed ParseError. */
function createParseError(
  message: string,
  location: { start: { offset: number; line: number; column: number }; end: { offset: number; line: number; column: number } },
  expected?: string[],
  found?: string
): ParseError {
  return {
    message,
    location: {
      start: { ...location.start },
      end: { ...location.end },
    },
    expected,
    found,
  };
}

export type { ParsedQuery, ParseError };
export type * from './types.js';
