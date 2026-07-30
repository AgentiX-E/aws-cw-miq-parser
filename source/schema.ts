// Runtime validation of ParsedQuery AST structure using Zod.
// Provides an additional safety layer beyond TypeScript's compile-time checks.
// Useful when consuming parsed output from untrusted sources or serialized data.

import { z } from 'zod';

// ---- Reusable sub-schemas ----

const positionSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const sourceLocationSchema = z.object({
  start: positionSchema,
  end: positionSchema,
});

const aggregationFunctionSchema = z.enum(['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']);

const comparisonOperatorSchema = z.enum(['=', '!=', '<', '<=', '>', '>=']);

const logicalOperatorSchema = z.enum(['AND', 'OR']).nullable();

// ---- Clause schemas ----

const selectClauseSchema = z.object({
  type: z.literal('SelectClause'),
  function: aggregationFunctionSchema,
  metricName: z.string().min(1),
  location: sourceLocationSchema,
});

const namespaceFromSchema = z.object({
  type: z.literal('NamespaceFrom'),
  namespace: z.string().min(1),
  location: sourceLocationSchema,
});

const schemaFromSchema = z.object({
  type: z.literal('SchemaFrom'),
  namespace: z.string().min(1),
  dimensions: z.array(z.string()),
  location: sourceLocationSchema,
});

const fromClauseSchema = z.discriminatedUnion('type', [
  namespaceFromSchema,
  schemaFromSchema,
]);

const whereConditionSchema = z.object({
  type: z.literal('WhereCondition'),
  labelKey: z.string().min(1),
  operator: comparisonOperatorSchema,
  labelValue: z.union([z.string(), z.number()]),
  isTag: z.boolean(),
  logicalOperator: logicalOperatorSchema,
  location: sourceLocationSchema,
});

const whereClauseSchema = z.object({
  type: z.literal('WhereClause'),
  conditions: z.array(whereConditionSchema).min(1),
  location: sourceLocationSchema,
});

const groupByItemSchema = z.object({
  type: z.literal('GroupByItem'),
  labelKey: z.string().min(1),
  isTag: z.boolean(),
  location: sourceLocationSchema,
});

const groupByClauseSchema = z.object({
  type: z.literal('GroupByClause'),
  items: z.array(groupByItemSchema).min(1),
  location: sourceLocationSchema,
});

const orderByClauseSchema = z.object({
  type: z.literal('OrderByClause'),
  function: aggregationFunctionSchema,
  direction: z.enum(['ASC', 'DESC']),
  location: sourceLocationSchema,
});

const limitClauseSchema = z.object({
  type: z.literal('LimitClause'),
  value: z.number().int().min(1).max(500),
  location: sourceLocationSchema,
});

// ---- Root query schema ----

/** Zod schema for validating ParsedQuery AST structures at runtime. */
export const parsedQuerySchema = z.object({
  type: z.literal('MetricsInsightsQuery'),
  select: selectClauseSchema,
  from: fromClauseSchema,
  where: whereClauseSchema.optional(),
  groupBy: groupByClauseSchema.optional(),
  orderBy: orderByClauseSchema.optional(),
  limit: limitClauseSchema.optional(),
  location: sourceLocationSchema,
});

/** Inferred TypeScript type from the schema (matches ParsedQuery). */
export type ValidatedParsedQuery = z.infer<typeof parsedQuerySchema>;

/**
 * Validate an object against the ParsedQuery schema at runtime.
 * Returns the parsed data with full type inference on success,
 * or throws a ZodError with detailed validation messages on failure.
 *
 * @param data - The object to validate (typically output from parse()).
 * @returns The validated and typed ParsedQuery.
 * @throws {z.ZodError} If validation fails.
 */
export function validateAst(data: unknown): ValidatedParsedQuery {
  return parsedQuerySchema.parse(data);
}

/**
 * Safe variant that returns a result instead of throwing.
 *
 * @returns An object with `success` and either `data` or `error`.
 */
export function safeValidateAst(data: unknown):
  | { success: true; data: ValidatedParsedQuery }
  | { success: false; error: z.ZodError } {
  const result = parsedQuerySchema.safeParse(data);
  if (result.success) {
    return result;
  }
  return { success: false, error: result.error };
}
