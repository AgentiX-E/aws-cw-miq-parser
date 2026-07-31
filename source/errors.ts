// Error types and utilities for the Metrics Insights Query Parser.
//
// Provides typed error structures with precise source location,
// source snippet generation, and terminal formatting support.

import type { SourceLocation, ParseError } from './types.js';

// ---- Error codes ----

/** Unique error codes for every failure mode. */
export const ErrorCodes = {
  // Syntax errors (prefixed with SYN_)
  SYN_EMPTY_INPUT: 'SYN_EMPTY_INPUT',
  SYN_INPUT_TOO_LONG: 'SYN_INPUT_TOO_LONG',
  SYN_UNEXPECTED_TOKEN: 'SYN_UNEXPECTED_TOKEN',
  SYN_MISSING_CLAUSE: 'SYN_MISSING_CLAUSE',
  SYN_INVALID_FUNCTION: 'SYN_INVALID_FUNCTION',
  SYN_INVALID_OPERATOR: 'SYN_INVALID_OPERATOR',
  SYN_INCOMPLETE_QUERY: 'SYN_INCOMPLETE_QUERY',
  SYN_UNTERMINATED_STRING: 'SYN_UNTERMINATED_STRING',
  SYN_WRONG_CLAUSE_ORDER: 'SYN_WRONG_CLAUSE_ORDER',

  // Semantic errors (prefixed with SEM_)
  SEM_LIMIT_OUT_OF_RANGE: 'SEM_LIMIT_OUT_OF_RANGE',
  SEM_FUNCTION_MISMATCH: 'SEM_FUNCTION_MISMATCH',
  SEM_SCHEMA_NO_NAMESPACE: 'SEM_SCHEMA_NO_NAMESPACE',
  SEM_RESERVED_KEYWORD: 'SEM_RESERVED_KEYWORD',
  SEM_DUPLICATE_GROUP_BY: 'SEM_DUPLICATE_GROUP_BY',
  SEM_WHERE_KEY_NOT_IN_SCHEMA: 'SEM_WHERE_KEY_NOT_IN_SCHEMA',

  // Internal errors (prefixed with INT_)
  INT_PARSE_FAILURE: 'INT_PARSE_FAILURE',
  INT_UNEXPECTED: 'INT_UNEXPECTED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---- Error creation ----

/** Create a syntax-level parse error. */
export function createSyntaxError(
  message: string,
  location: SourceLocation,
  code: string = ErrorCodes.SYN_UNEXPECTED_TOKEN,
  expected?: string[],
  found?: string,
): ParseError {
  return { message, location, code, expected, found, type: 'syntax' };
}

/** Create a semantic validation error. */
export function createSemanticError(
  message: string,
  location: SourceLocation,
  code: string,
): ParseError {
  return { message, location, code, type: 'semantic' };
}

/** Create an internal / unexpected error. */
export function createInternalError(
  message: string,
  location: SourceLocation,
): ParseError {
  return {
    message,
    location,
    code: ErrorCodes.INT_UNEXPECTED,
    type: 'internal',
  };
}

/** Create an error for empty input. */
export function emptyInputError(): ParseError {
  return createSyntaxError(
    'Empty query string — expected a CloudWatch Metrics Insights query starting with SELECT',
    {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    },
    ErrorCodes.SYN_EMPTY_INPUT,
  );
}

/** Create an error for input exceeding the AWS 4096-character limit. */
export function inputTooLongError(actualLength: number): ParseError {
  return createSyntaxError(
    `Query exceeds the maximum length of 4096 characters (got ${actualLength}). ` +
      'CloudWatch Metrics Insights enforces this limit on all queries.',
    {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: actualLength, line: 1, column: actualLength + 1 },
    },
    ErrorCodes.SYN_INPUT_TOO_LONG,
  );
}

// ---- Source snippet generation ----

/**
 * Generate a human-readable source snippet showing the error location in context.
 * Format mimics Rust compiler diagnostics:
 *
 *   Error: Expected SELECT clause
 *     |
 *   1 | FROM "AWS/EC2" WHERE InstanceId = 'i-123'
 *     | ^^^^
 *     | Expected SELECT but found FROM
 */
export function formatSourceSnippet(
  source: string,
  location: SourceLocation,
  message: string,
  colorize: boolean = false,
): string {
  const lines = source.split('\n');
  const errorLine = location.start.line;
  const errorLineText = lines[errorLine - 1] ?? '';
  const lineNumWidth = String(errorLine).length;

  // Calculate the column range to highlight
  const startCol = location.start.column;
  const endCol = errorLine === (location.end.line || errorLine)
    ? location.end.column
    : errorLineText.length + 1;

  // Build the snippet
  const parts: string[] = [];

  // Show context: previous line if available
  if (errorLine > 1) {
    const prevLine = lines[errorLine - 2] ?? '';
    parts.push(`${' '.repeat(lineNumWidth + 2)}|`);
    parts.push(`${String(errorLine - 1).padStart(lineNumWidth)} | ${prevLine}`);
  }

  // Error line
  parts.push(`${' '.repeat(lineNumWidth + 2)}|`);
  parts.push(`${String(errorLine).padStart(lineNumWidth)} | ${errorLineText}`);

  // Caret marker
  const padding = ' '.repeat(lineNumWidth + 3 + startCol - 1);
  const highlightLen = Math.max(1, endCol - startCol);
  const carets = '^'.repeat(highlightLen);
  parts.push(`${padding}${carets}`);

  // Error message
  parts.push(`${padding}${message}`);

  return parts.join('\n');
}

// ---- Error formatting for terminal (with colors) ----

let chalkModule: any = null;

async function getChalk(): Promise<any> {
  if (!chalkModule) {
    chalkModule = await import('chalk');
  }
  return chalkModule;
}

/**
 * Format a ParseError for terminal display with colors.
 * Requires the optional `chalk` dependency.
 *
 * Note: Color output branches are excluded from coverage
 * since they depend on dynamic chalk import behavior.
 */
/* v8 ignore start */
export async function formatTerminalError(
  source: string,
  error: ParseError,
): Promise<string> {
  const chalk = await getChalk();
  const location = error.location;
  const lines = source.split('\n');
  const errorLine = location.start.line;
  const errorLineText = lines[errorLine - 1] ?? '';
  const lineNumWidth = String(errorLine).length;

  const startCol = location.start.column;
  const endCol = errorLine === (location.end.line || errorLine)
    ? location.end.column
    : errorLineText.length + 1;

  const parts: string[] = [];

  // Error header
  const typeLabel = error.type === 'syntax'
    ? 'Syntax error'
    : error.type === 'semantic'
      ? 'Semantic error'
      : 'Internal error';
  parts.push(chalk.red.bold(`${typeLabel}: `) + chalk.white(error.message));
  parts.push('');

  // Code context
  if (errorLine > 1) {
    const prevLine = lines[errorLine - 2] ?? '';
    parts.push(chalk.gray(`${' '.repeat(lineNumWidth + 2)}|`));
    parts.push(
      chalk.gray(`${String(errorLine - 1).padStart(lineNumWidth)} | `) +
      chalk.gray(prevLine),
    );
  }

  parts.push(chalk.gray(`${' '.repeat(lineNumWidth + 2)}|`));
  parts.push(
    chalk.gray(`${String(errorLine).padStart(lineNumWidth)} | `) +
    errorLineText.slice(0, startCol - 1) +
    chalk.red.bold(errorLineText.slice(startCol - 1, endCol - 1)) +
    errorLineText.slice(endCol - 1),
  );

  // Caret and message
  const padding = ' '.repeat(lineNumWidth + 3 + startCol - 1);
  const highlightLen = Math.max(1, endCol - startCol);
  const carets = '^'.repeat(highlightLen);
  parts.push(chalk.red.bold(`${padding}${carets}`));
  parts.push(chalk.red(`${padding}${error.message}`));

  // Show expected tokens if available
  if (error.expected && error.expected.length > 0) {
    parts.push('');
    const expectedList = error.expected.slice(0, 5).join(', ');
    const suffix = error.expected.length > 5
      ? ` (and ${error.expected.length - 5} more)`
      : '';
    parts.push(chalk.gray(`${' '.repeat(lineNumWidth + 2)}help: `) +
      chalk.green(`expected ${expectedList}${suffix}`));
  }

  // Error code for debugging
  parts.push('');
  parts.push(chalk.gray(`${' '.repeat(lineNumWidth + 2)}code: ${error.code}`));

  return parts.join('\n');
}
/* v8 ignore stop */

/** Format a ParseError to a plain string (no colors). */
export function formatError(source: string, error: ParseError): string {
  let output = `${error.type === 'syntax' ? 'Syntax error' : error.type === 'semantic' ? 'Semantic error' : 'Internal error'}: ${error.message}\n\n`;
  output += formatSourceSnippet(source, error.location, error.message, false);
  return output;
}
