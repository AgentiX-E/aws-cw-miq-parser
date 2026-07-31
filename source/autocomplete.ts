// Autocomplete data provider for CloudWatch Metrics Insights queries.
//
// Exports structured completion data for building LSP-compatible autocomplete
// in editors (VS Code, Monaco, CodeMirror). Provides keyword lists, function
// signatures, and completion item factories.

// ---- Keyword definitions ----

/** MIQ clause-level keywords. */
export const CLAUSE_KEYWORDS = [
  { label: 'SELECT', detail: 'Start a Metrics Insights query', insertText: 'SELECT ' },
  { label: 'FROM', detail: 'Specify the metric namespace', insertText: 'FROM ' },
  { label: 'WHERE', detail: 'Filter metrics by dimension values', insertText: 'WHERE ' },
  { label: 'GROUP BY', detail: 'Group results by dimension keys', insertText: 'GROUP BY ' },
  { label: 'ORDER BY', detail: 'Sort results by aggregation function', insertText: 'ORDER BY ' },
  { label: 'LIMIT', detail: 'Limit the number of returned time series (max 500)', insertText: 'LIMIT ' },
] as const;

/** Aggregation functions available in SELECT and ORDER BY. */
export const AGGREGATION_FUNCTIONS = [
  { label: 'AVG', detail: 'Average of metric observations', insertText: 'AVG(${1:metricName})' },
  { label: 'COUNT', detail: 'Count of metric observations', insertText: 'COUNT(${1:metricName})' },
  { label: 'MAX', detail: 'Maximum metric observation', insertText: 'MAX(${1:metricName})' },
  { label: 'MIN', detail: 'Minimum metric observation', insertText: 'MIN(${1:metricName})' },
  { label: 'SUM', detail: 'Sum of metric observations', insertText: 'SUM(${1:metricName})' },
] as const;

/** Comparison operators for WHERE clause. */
export const COMPARISON_OPERATORS = [
  { label: '=', detail: 'Equal to' },
  { label: '!=', detail: 'Not equal to' },
  { label: '<', detail: 'Less than' },
  { label: '<=', detail: 'Less than or equal to' },
  { label: '>', detail: 'Greater than' },
  { label: '>=', detail: 'Greater than or equal to' },
] as const;

/** Logical operators for combining WHERE conditions. */
export const LOGICAL_OPERATORS = [
  { label: 'AND', detail: 'Both conditions must match' },
  { label: 'OR', detail: 'Either condition must match' },
] as const;

/** Sort directions for ORDER BY. */
export const SORT_DIRECTIONS = [
  { label: 'ASC', detail: 'Ascending order (default)' },
  { label: 'DESC', detail: 'Descending order' },
] as const;

/** Special keywords and functions. */
export const SPECIAL_TOKENS = [
  { label: 'SCHEMA', detail: 'FROM table function — scope to exact dimension sets', insertText: 'SCHEMA("${1:namespace}"${2:, dimensionKey})' },
  { label: 'tag.', detail: 'Reference an AWS resource tag', insertText: 'tag.' },
  { label: 'CURRENT_ACCOUNT_ID()', detail: 'Filter by the current monitoring account', insertText: 'CURRENT_ACCOUNT_ID()' },
  { label: 'AWS.AccountId', detail: 'Filter or group by source account ID (cross-account queries)', insertText: 'AWS.AccountId' },
] as const;

// ---- Completion item factory ----

/** A completion item compatible with LSP/Monaco CompletionItem. */
export interface CompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  kind?: 'keyword' | 'function' | 'operator' | 'special';
}

/** Context for determining which completions are relevant. */
export interface CompletionContext {
  /** Text before the cursor on the current line. */
  textBeforeCursor: string;
  /** The full query text. */
  fullText: string;
  /** 0-indexed cursor position in the full text. */
  cursorOffset: number;
}

/**
 * Get all available completions for Metrics Insights queries.
 * Returns suggestions appropriate for any position in a query.
 *
 * @param context - Optional completion context for contextual suggestions.
 * @returns Array of completion items.
 */
export function getCompletions(context?: CompletionContext): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Always suggest clause keywords
  for (const kw of CLAUSE_KEYWORDS) {
    items.push({ ...kw, kind: 'keyword' as const });
  }

  // Always suggest aggregation functions
  for (const fn of AGGREGATION_FUNCTIONS) {
    items.push({ ...fn, kind: 'function' as const });
  }

  // Context-sensitive suggestions
  if (context) {
    const line = context.textBeforeCursor.toUpperCase().trim();

    if (line.includes('WHERE') || line.includes('AND') || line.includes('OR')) {
      for (const op of COMPARISON_OPERATORS) {
        items.push({ ...op, kind: 'operator' as const });
      }
      for (const lo of LOGICAL_OPERATORS) {
        items.push({ ...lo, kind: 'keyword' as const });
      }
    }

    if (line.includes('ORDER BY')) {
      for (const sd of SORT_DIRECTIONS) {
        items.push({ ...sd, kind: 'keyword' as const });
      }
    }
  }

  // Always suggest special tokens
  for (const st of SPECIAL_TOKENS) {
    items.push({ ...st, kind: 'special' as const });
  }

  return items;
}

/**
 * Get all MIQ keywords as a flat string array (for syntax highlighting).
 */
export function getAllKeywords(): string[] {
  return [
    ...CLAUSE_KEYWORDS.flatMap((k) => k.label.split(' ')),
    ...AGGREGATION_FUNCTIONS.map((f) => f.label),
    ...COMPARISON_OPERATORS.map((o) => o.label),
    ...LOGICAL_OPERATORS.map((l) => l.label),
    ...SORT_DIRECTIONS.map((s) => s.label),
    'SCHEMA',
    'CURRENT_ACCOUNT_ID',
  ];
}

/**
 * Get all aggregation function names (for validation or highlighting).
 */
export function getFunctionNames(): string[] {
  return AGGREGATION_FUNCTIONS.map((f) => f.label);
}
