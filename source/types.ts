// Types for the CloudWatch Metrics Insights Query Parser
// These types represent the JSON AST output after parsing an MIQ query string.

/** Supported aggregation functions in Metrics Insights. */
export type AggregationFunction = 'AVG' | 'COUNT' | 'MAX' | 'MIN' | 'SUM';

/** Comparison operators supported in WHERE clause conditions. */
export type ComparisonOperator = '=' | '!=' | '<' | '<=' | '>' | '>=';

/** Logical operator connecting WHERE conditions. `null` for the first condition. */
export type LogicalOperator = 'AND' | 'OR' | null;

/** Sort direction for ORDER BY clause. */
export type SortDirection = 'ASC' | 'DESC';

/**
 * Position within source string. Line and column are 1-indexed;
 * offset is 0-indexed (byte offset from start).
 */
export interface Position {
  line: number;
  column: number;
  offset: number;
}

/** Source location span tracking start and end positions. */
export interface SourceLocation {
  start: Position;
  end: Position;
}

/** A comment found in the source query. */
export interface Comment {
  type: 'LineComment' | 'BlockComment';
  /** The comment text including delimiters, e.g. "-- text" or block comment markers. */
  text: string;
  location: SourceLocation;
}

/** Base fields shared by all AST nodes that may have attached comments. */
export interface CommentAttachable {
  /** Comments appearing immediately before this node in the source. */
  leadingComments?: Comment[];
  /** Comments appearing on the same line after this node. */
  trailingComments?: Comment[];
}

// --- Clause Types ---

/** SELECT clause: specifies the aggregation function and target metric. */
export interface SelectClause extends CommentAttachable {
  type: 'SelectClause';
  function: AggregationFunction;
  metricName: string;
  location: SourceLocation;
}

/** FROM clause using a bare namespace without SCHEMA. */
export interface NamespaceFrom extends CommentAttachable {
  type: 'NamespaceFrom';
  namespace: string;
  location: SourceLocation;
}

/** FROM clause using SCHEMA table function with namespace and optional dimension keys. */
export interface SchemaFrom extends CommentAttachable {
  type: 'SchemaFrom';
  namespace: string;
  dimensions: string[];
  location: SourceLocation;
}

/** Union type for FROM clause variants. */
export type FromClause = NamespaceFrom | SchemaFrom;

/** A single condition within a WHERE clause. */
export interface WhereCondition extends CommentAttachable {
  type: 'WhereCondition';
  labelKey: string;
  operator: ComparisonOperator;
  labelValue: string | number;
  /** Derived from `tag.` prefix on labelKey. */
  isTag: boolean;
  /** `null` for the first condition in the chain. */
  logicalOperator: LogicalOperator;
  location: SourceLocation;
}

/** WHERE clause: a chain of AND-connected conditions. */
export interface WhereClause extends CommentAttachable {
  type: 'WhereClause';
  conditions: WhereCondition[];
  location: SourceLocation;
}

/** A single item in the GROUP BY clause. */
export interface GroupByItem extends CommentAttachable {
  type: 'GroupByItem';
  labelKey: string;
  /** Derived from `tag.` prefix on labelKey. */
  isTag: boolean;
  location: SourceLocation;
}

/** GROUP BY clause. */
export interface GroupByClause extends CommentAttachable {
  type: 'GroupByClause';
  items: GroupByItem[];
  location: SourceLocation;
}

/** ORDER BY clause. */
export interface OrderByClause extends CommentAttachable {
  type: 'OrderByClause';
  function: AggregationFunction;
  direction: SortDirection;
  location: SourceLocation;
}

/** LIMIT clause. */
export interface LimitClause extends CommentAttachable {
  type: 'LimitClause';
  value: number;
  location: SourceLocation;
}

// --- Top-Level AST ---

/** Root node type discriminator. */
export type QueryType = 'MetricsInsightsQuery';

/**
 * The complete parsed representation of a CloudWatch Metrics Insights query.
 * Every node carries its source location for error reporting and tooling.
 * Comments are attached to the nearest AST node for formatter preservation.
 */
export interface ParsedQuery extends CommentAttachable {
  type: QueryType;
  select: SelectClause;
  from: FromClause;
  where?: WhereClause;
  groupBy?: GroupByClause;
  orderBy?: OrderByClause;
  limit?: LimitClause;
  /** Source location spanning the entire query string. */
  location: SourceLocation;
}

// --- Error Types ---

/** Severity level for validation messages. */
export type ValidationSeverity = 'error' | 'warning';

/** A single validation message (error or warning). */
export interface ValidationMessage {
  severity: ValidationSeverity;
  message: string;
  location?: SourceLocation;
  code: string;
}

/** Result of semantic validation. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

/** Parse error with precise source location and human-readable message. */
export interface ParseError {
  message: string;
  location: SourceLocation;
  /** Unique error code for programmatic handling. */
  code: string;
  /** Error category discriminator. */
  type: 'syntax' | 'semantic' | 'internal';
  /** Tokens that were expected at the error position (syntax errors). */
  expected?: string[];
  /** Token that was found instead of what was expected. */
  found?: string;
}
