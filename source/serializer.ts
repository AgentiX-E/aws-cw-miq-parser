// Serializer: converts a ParsedQuery AST back into a Metrics Insights query string.
//
// Guarantees round-trip property: parse(serialize(parse(q))) ≡ parse(q)
// Note: output may differ in whitespace/quoting style but preserves all semantics.

import type { ParsedQuery, FromClause, WhereClause, GroupByClause, OrderByClause } from './types.js';

/** Options controlling serialization output style. */
export interface SerializeOptions {
  /** Enable pretty-printing with line breaks and indentation. Default: false. */
  pretty?: boolean;
  /** Number of spaces per indentation level. Default: 2. */
  indent?: number;
  /** Force keywords to uppercase. Default: true. */
  uppercase?: boolean;
}

const DEFAULT_OPTIONS: Required<SerializeOptions> = {
  pretty: false,
  indent: 2,
  uppercase: true,
};

/**
 * Serialize a ParsedQuery AST back to a Metrics Insights SQL query string.
 *
 * @param query - The parsed query AST to serialize.
 * @param options - Formatting options.
 * @returns A valid Metrics Insights query string.
 */
export function serialize(query: ParsedQuery, options?: SerializeOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parts: string[] = [];

  // Preserve leading comments
  if (query.leadingComments && query.leadingComments.length > 0) {
    for (const c of query.leadingComments) {
      parts.push(c.text);
    }
    if (!opts.pretty) {
      // Ensure line comment on its own line doesn't consume the SELECT
      parts[parts.length - 1] += '\n';
    }
  }

  parts.push(serializeSelect(query, opts));
  parts.push(serializeFrom(query, opts));

  if (query.where) {
    parts.push(serializeWhere(query.where, opts));
  }
  if (query.groupBy) {
    parts.push(serializeGroupBy(query.groupBy, opts));
  }
  if (query.orderBy) {
    parts.push(serializeOrderBy(query.orderBy, opts));
  }
  if (query.limit) {
    parts.push(serializeLimit(query, opts));
  }

  // Preserve trailing comments
  if (query.trailingComments && query.trailingComments.length > 0) {
    parts.push(query.trailingComments.map((c) => c.text).join(' '));
  }

  const separator = opts.pretty ? '\n' : ' ';
  return parts.join(separator);
}

// ---- Clause serializers ----

function kw(word: string, opts: Required<SerializeOptions>): string {
  return opts.uppercase ? word.toUpperCase() : word.toLowerCase();
}

function serializeSelect(query: ParsedQuery, opts: Required<SerializeOptions>): string {
  return `${kw('SELECT', opts)} ${query.select.function}(${quoteIdentifier(query.select.metricName)})`;
}

function serializeFrom(query: ParsedQuery, opts: Required<SerializeOptions>): string {
  const fromKw = `${kw('FROM', opts)} `;

  if (query.from.type === 'NamespaceFrom') {
    return fromKw + quoteIdentifier(query.from.namespace);
  }

  // SchemaFrom
  const dims = [quoteIdentifier(query.from.namespace), ...query.from.dimensions.map(quoteIdentifier)];
  return `${fromKw}${kw('SCHEMA', opts)}(${dims.join(', ')})`;
}

function serializeWhere(where: WhereClause, opts: Required<SerializeOptions>): string {
  const conditions = where.conditions.map((c, i) => {
    const prefix = i > 0 && c.logicalOperator
      ? `${kw(c.logicalOperator, opts)} `
      : '';
    const labelKey = serializeLabelKey(c.labelKey, c.isTag);
    const value = typeof c.labelValue === 'number'
      ? String(c.labelValue)
      : `'${c.labelValue}'`;
    return `${prefix}${labelKey} ${c.operator} ${value}`;
  });

  return `${kw('WHERE', opts)} ${conditions.join(' ')}`;
}

function serializeGroupBy(groupBy: GroupByClause, opts: Required<SerializeOptions>): string {
  const items = groupBy.items.map((item) => {
    return serializeLabelKey(item.labelKey, item.isTag);
  });

  return `${kw('GROUP BY', opts)} ${items.join(', ')}`;
}

function serializeOrderBy(orderBy: OrderByClause, opts: Required<SerializeOptions>): string {
  const dir = orderBy.direction === 'DESC' ? ` ${kw('DESC', opts)}` : '';
  return `${kw('ORDER BY', opts)} ${orderBy.function}()${dir}`;
}

function serializeLimit(query: ParsedQuery, opts: Required<SerializeOptions>): string {
  return `${kw('LIMIT', opts)} ${query.limit!.value}`;
}

// ---- Identifier quoting ----

/**
 * Serialize a label key, preserving tag prefix and quoting tag keys
 * that contain special characters (e.g., "aws:cloudformation:stack-name").
 */
function serializeLabelKey(labelKey: string, isTag: boolean): string {
  if (!isTag) {
    return labelKey;
  }

  // Extract the tag key portion from "tag.xxx"
  let tagKey = labelKey;
  if (tagKey.startsWith('tag.')) {
    tagKey = tagKey.slice(4);
  }

  // Quote the tag key if it contains special characters
  const serializedKey = quoteIdentifier(tagKey);
  return `tag.${serializedKey}`;
}

/**
 * Quote an identifier if it contains special characters or is a reserved word.
 * Always quotes identifiers with `/`, `.`, `:`, spaces, or leading digits.
 */
export function quoteIdentifier(name: string): string {
  if (needsQuoting(name)) {
    return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return name;
}

function needsQuoting(name: string): boolean {
  // Must be quoted if it contains characters outside [a-zA-Z0-9_]
  return !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}
