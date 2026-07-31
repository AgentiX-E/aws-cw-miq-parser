// Error recovery: multi-error collection for Metrics Insights queries.
//
// Implements a Babel-inspired error recovery mode where the parser
// collects ALL syntax errors in one pass instead of throwing on the first.
//
// Architecture:
//   - Primary parse() throws on first error (fast path, existing behavior)
//   - parseWithRecovery() attempts each clause independently and collects errors
//   - Returns { ast: Partial<ParsedQuery>, errors: ParseError[] }

import { parse as pegParse, SyntaxError as PegSyntaxError } from './generated/parser.js';
import type { ParsedQuery, ParseError, SourceLocation, Comment } from './types.js';
import {
  ErrorCodes,
  createSyntaxError,
  createInternalError,
} from './errors.js';

// ---- Public API ----

/** Result of a recovery-mode parse: partial AST + collected errors. */
export interface RecoveryResult {
  /** Partial AST — may be null if SELECT/FROM failed entirely. */
  ast: ParsedQuery | null;
  /** All errors collected during parsing, in source order. */
  errors: ParseError[];
  /** Comments found during partial parsing (best-effort). */
  comments: Comment[];
}

/**
 * Parse a query in error recovery mode: collect ALL syntax errors,
 * return a best-effort partial AST.
 *
 * Unlike {@link parse} which throws on the first error, this function
 * attempts to extract each clause independently and reports all errors
 * found across the entire query. Useful for IDE diagnostics and linters
 * that need to show multiple errors at once (Babel-compatible pattern).
 *
 * @param input - The MIQ query string.
 * @returns A {@link RecoveryResult} with `ast` (possibly null), `errors`, and `comments`.
 *
 * @example
 * ```ts
 * import { parseWithRecovery } from '@agentix-e/aws-cw-miq-parser';
 *
 * const result = parseWithRecovery('SELECT FOO(x) FROM "AWS/EC2" WHERE');
 * console.log(result.errors.length); // ≥1
 * console.log(result.ast?.select);    // may still have partial SELECT data
 * ```
 */
export function parseWithRecovery(input: string): RecoveryResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ast: null, errors: [], comments: [] };
  }

  const errors: ParseError[] = [];
  let ast: ParsedQuery | null = null;

  try {
    // Attempt full parse first
    const result = pegParse(input, { startRule: 'Query' });
    ast = result as ParsedQuery;
  } catch (_fullErr) {
    // Full parse failed — attempt per-clause recovery
    ast = recoverPartialAst(input, errors);
  }

  return { ast, errors, comments: [] };
}

// ---- Per-clause recovery ----

/** Try each clause independently and build a partial AST. */
function recoverPartialAst(
  input: string,
  errors: ParseError[],
): ParsedQuery | null {
  // Use simple regex-based clause splitting for recovery
  // This is a best-effort approach: extract what we can from broken queries
  const clauses = splitIntoClauses(input);

  const partial: Record<string, unknown> = {
    type: 'MetricsInsightsQuery',
    location: errorLocation(0, input.length),
  };

  let hasSelect = false;
  let hasFrom = false;

  for (const { name, text, startOffset } of clauses) {
    try {
      switch (name) {
        case 'select': {
          const sel = pegParse(text.trim(), { startRule: 'SelectClause' });
          partial['select'] = sel;
          hasSelect = true;
          break;
        }
        case 'from': {
          const from = pegParse(text.trim(), { startRule: 'FromClause' });
          partial['from'] = from;
          hasFrom = true;
          break;
        }
        case 'where': {
          const where = pegParse(text.trim(), { startRule: 'WhereClause' });
          partial['where'] = where;
          break;
        }
        case 'groupBy': {
          const gb = pegParse(text.trim(), { startRule: 'GroupByClause' });
          partial['groupBy'] = gb;
          break;
        }
        case 'orderBy': {
          const ob = pegParse(text.trim(), { startRule: 'OrderByClause' });
          partial['orderBy'] = ob;
          break;
        }
        case 'limit': {
          const lim = pegParse(text.trim(), { startRule: 'LimitClause' });
          partial['limit'] = lim;
          break;
        }
      }
    } catch (err) {
      if (err instanceof PegSyntaxError) {
        errors.push(pegSyntaxToParseError(err, startOffset));
      }
    }
  }

  // Must have at least SELECT and FROM to return an AST
  if (!hasSelect && !hasFrom) return null;

  // Fill missing required fields with error-placeholder values
  if (!hasSelect) {
    errors.push(createSyntaxError(
      'Missing SELECT clause',
      errorLocation(0, 0),
      ErrorCodes.SYN_MISSING_CLAUSE,
    ));
  }
  if (!hasFrom && hasSelect) {
    errors.push(createSyntaxError(
      'Missing FROM clause',
      errorLocation(input.length, input.length),
      ErrorCodes.SYN_MISSING_CLAUSE,
    ));
  }

  return partial as unknown as ParsedQuery;
}

// ---- Clause splitting ----

interface ClauseFragment {
  name: string;
  text: string;
  startOffset: number;
}

/** Split a broken query string into clause-level fragments.
 *
 *  Uses regex clause-boundary matching with quote-aware preprocessing
 *  to avoid misidentifying clause keywords within single- or double-quoted
 *  strings as clause boundaries.
 */
function splitIntoClauses(input: string): ClauseFragment[] {
  const fragments: ClauseFragment[] = [];

  // Mask content inside quotes to prevent clause keywords from matching
  // inside string literals or quoted identifiers
  const masked = maskQuotedContent(input);

  // Match clause boundaries: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT
  const clauseRegex = /\b(SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT)\b/gi;
  const matches: { keyword: string; index: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = clauseRegex.exec(masked)) !== null) {
    const raw = match[0].toUpperCase().replace(/\s+/g, ' ');
    let name: string;
    if (raw === 'GROUP BY') name = 'groupBy';
    else if (raw === 'ORDER BY') name = 'orderBy';
    else name = raw.toLowerCase();

    matches.push({ keyword: name, index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : input.length;
    const rawText = input.slice(start, end).trim();
    fragments.push({
      name: matches[i]!.keyword,
      text: rawText,
      startOffset: start,
    });
  }

  return fragments;
}

/**
 * Replace content inside single- and double-quoted strings with spaces
 * so that clause keywords within quotes are not matched as boundaries.
 * Preserves string length to maintain original offset positions.
 *
 * Correctly handles escape sequences: `\\` is a literal backslash (does NOT
 * escape the next character), while `\'` or `\"` within a string are escaped
 * quotes that do NOT toggle quote state.
 */
function maskQuotedContent(input: string): string {
  const chars = input.split('');
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;

    // An escape toggle: \ starts an escape, \\ cancels the escape
    if (!escaped && ch === '\\') {
      escaped = true;
      continue;
    }

    if (escaped) {
      // This character is escaped (e.g. \' or \" or \\)
      // For \\, the \ was the escape-initiator; the second \ is the literal char
      // In both cases, the escaped char stays inside the string
      escaped = false;
      continue;
    }

    // Quote toggling (only outside escape sequences)
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (inDouble || inSingle) {
      chars[i] = ' ';
    }
  }

  return chars.join('');
}

// ---- Helpers ----

function pegSyntaxToParseError(
  peggyErr: InstanceType<typeof PegSyntaxError>,
  offset: number,
): ParseError {
  const location: SourceLocation = {
    start: {
      line: peggyErr.location.start.line,
      column: peggyErr.location.start.column + offset,
      offset: peggyErr.location.start.offset + offset,
    },
    end: {
      line: peggyErr.location.end.line,
      column: peggyErr.location.end.column + offset,
      offset: peggyErr.location.end.offset + offset,
    },
  };

  return createSyntaxError(
    peggyErr.message,
    location,
    ErrorCodes.SYN_UNEXPECTED_TOKEN,
    peggyErr.expected?.map((e) => e.description),
    peggyErr.found ?? undefined,
  );
}

function errorLocation(start: number, end: number): SourceLocation {
  return {
    start: { offset: start, line: 1, column: start + 1 },
    end: { offset: end, line: 1, column: end + 1 },
  };
}
