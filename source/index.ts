// Public API for @agentix/aws-cw-miq-parser
//
// This module exports the core parsing functionality for CloudWatch
// Metrics Insights query strings, including error formatting,
// serialization, semantic validation, and AST traversal utilities.

export { parse, ErrorCodes } from './parser.js';
export { validate } from './validator.js';
export { validateAst, safeValidateAst, parsedQuerySchema } from './schema.js';
export { serialize, quoteIdentifier } from './serializer.js';
export type { SerializeOptions } from './serializer.js';
export { traverse } from './visitor.js';
export type { QueryVisitor } from './visitor.js';
export { lint, listRules } from './linter.js';
export type { LintRule, LinterOptions, LintSeverity } from './linter.js';
export {
  formatError,
  formatSourceSnippet,
  formatTerminalError,
} from './errors.js';

// Re-export all type definitions
export type {
  AggregationFunction,
  ComparisonOperator,
  LogicalOperator,
  SortDirection,
  Position,
  SourceLocation,
  SelectClause,
  NamespaceFrom,
  SchemaFrom,
  FromClause,
  WhereCondition,
  WhereClause,
  GroupByItem,
  GroupByClause,
  OrderByClause,
  LimitClause,
  QueryType,
  ParsedQuery,
  ValidationSeverity,
  ValidationMessage,
  ValidationResult,
  ParseError,
} from './types.js';
