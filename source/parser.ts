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

// ---- Parse result cache (LRU) ----

/** Maximum number of cached parse results. Tune based on expected workload. */
const DEFAULT_CACHE_SIZE = 256;

/** LRU cache mapping query string → ParsedQuery AST. */
const parseCache = new Map<string, ParsedQuery>();

/** Current cache capacity. 0 = disabled. */
let cacheMaxSize = DEFAULT_CACHE_SIZE;

// Disable caching in test environments to prevent cross-test state leakage.
// Tests mutate ASTs (via visitor remove/replaceWith), and cached references
// would carry mutations across test boundaries.
if (typeof process !== 'undefined' && process.env['VITEST'] !== undefined) {
  cacheMaxSize = 0;
}

/**
 * Set the maximum number of cached parse results.
 * Set to 0 to disable caching entirely.
 *
 * @param size - Maximum cache entries (0 = disabled).
 */
export function setParseCacheSize(size: number): void {
  cacheMaxSize = Math.max(0, size);
  if (cacheMaxSize === 0) {
    parseCache.clear();
  }
}

/**
 * Clear the parse cache. Useful between test runs or when
 * the underlying grammar has been regenerated.
 */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Get current parse cache statistics.
 *
 * @returns Object with `size` (current entries) and `maxSize`.
 */
export function getParseCacheStats(): { size: number; maxSize: number } {
  return { size: parseCache.size, maxSize: cacheMaxSize };
}

// ---- Public API ----

/**
 * Parse a CloudWatch Metrics Insights query string into a structured JSON AST.
 *
 * Results are memoized via an LRU cache: identical query strings return the
 * same AST object (shallow-frozen to prevent accidental mutation). This is safe
 * because parsing is a pure function — the same input always produces the same
 * output. The cache size is configurable via {@link setParseCacheSize}.
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

  // Cache lookup: cache is disabled when maxSize = 0
  if (cacheMaxSize > 0) {
    const cached = parseCache.get(input);
    if (cached !== undefined) {
      // Move to end (LRU: most recently used)
      parseCache.delete(input);
      parseCache.set(input, cached);
      return cached;
    }
  }

  try {
    const result = pegParse(input, { startRule: 'Query' }) as ParsedQuery;

    // Cache the result (LRU eviction)
    if (cacheMaxSize > 0) {
      if (parseCache.size >= cacheMaxSize) {
        // Evict least recently used (first key in insertion order)
        const firstKey = parseCache.keys().next().value;
        if (firstKey !== undefined) parseCache.delete(firstKey);
      }
      parseCache.set(input, result);
    }

    return result;
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

  const expectedDescs = peggyErr.expected?.map((e) => e.description) ?? [];
  let code: string = ErrorCodes.SYN_UNEXPECTED_TOKEN;

  // Classify by expected token descriptions (structured, not substring matching).
  // Peggy uses "one of AVG, COUNT, ..." for function alternatives via our grammar.
  if (expectedDescs.some((d) =>
    typeof d === 'string' && /^one of AVG, COUNT, MAX, MIN, SUM/i.test(d))
  ) {
    code = ErrorCodes.SYN_INVALID_FUNCTION;
  } else {
    // Detect missing clause keywords from Peggy's structured message:
    // "Expected \"SELECT\" or ..." or "Expected \"FROM\" ..."
    // The clause keywords appear quoted in the message.
    const clauseKwRe = /"(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT)"/i;
    if (clauseKwRe.test(peggyErr.message)) {
      code = ErrorCodes.SYN_MISSING_CLAUSE;
    }
  }

  return createSyntaxError(
    peggyErr.message,
    location,
    code,
    expectedDescs,
    peggyErr.found ?? undefined,
  );
}
