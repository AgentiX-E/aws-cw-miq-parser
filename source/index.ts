// Public API for @agentix-e/aws-cw-miq-parser
//
// This module exports the core parsing functionality for CloudWatch
// Metrics Insights query strings, including error formatting,
// serialization, semantic validation, and AST traversal utilities.

export { parse, ErrorCodes } from './parser.js';
export { parseWithRecovery } from './recovery.js';
export type { RecoveryResult } from './recovery.js';
export { validate } from './validator.js';
export { validateAst, safeValidateAst, parsedQuerySchema } from './schema.js';
export { serialize, quoteIdentifier } from './serializer.js';
export type { SerializeOptions } from './serializer.js';
export { traverse, traverseWithPath, NodePath } from './visitor.js';
export type { QueryVisitor, PathVisitor, AstNode } from './visitor.js';
export {
  getCompletions,
  getAllKeywords,
  getFunctionNames,
  CLAUSE_KEYWORDS,
  AGGREGATION_FUNCTIONS,
  COMPARISON_OPERATORS,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  SPECIAL_TOKENS,
} from './autocomplete.js';
export type { CompletionItem, CompletionContext } from './autocomplete.js';
export { estimateCost } from './cost.js';
export type {
  CostEstimate,
  CostFactor,
  CostRecommendation,
} from './cost.js';
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
  Comment,
  CommentAttachable,
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
