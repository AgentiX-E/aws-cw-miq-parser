// Query linter: configurable static analysis rules for CloudWatch Metrics Insights queries.
//
// Provides rule-based analysis of parsed queries to detect anti-patterns,
// performance issues, and compliance violations.

import type { ParsedQuery } from './types.js';
import type { ValidationMessage } from './types.js';

/** Severity for linter rules. */
export type LintSeverity = 'off' | 'warn' | 'error';

/** Configuration for a linter rule. */
export interface LintRule {
  id: string;
  description: string;
  severity: LintSeverity;
  check(query: ParsedQuery): ValidationMessage[];
}

/** Linter options for configuring rules. */
export interface LinterOptions {
  rules?: Partial<Record<string, LintSeverity>>;
}

// ---- Built-in rules ----

/** Require SCHEMA() instead of bare namespace for query specificity. */
const requireSchemaRule: LintRule = {
  id: 'require-schema',
  description: 'Prefer SCHEMA() over bare namespace for explicit dimension matching',
  severity: 'warn',
  check(query) {
    if (query.from.type === 'NamespaceFrom') {
      return [{
        severity: 'warning',
        code: 'LINT_REQUIRE_SCHEMA',
        message: 'Consider using SCHEMA() instead of bare namespace to explicitly specify expected dimensions.',
        location: query.from.location,
      }];
    }
    return [];
  },
};

/** Enforce LIMIT on all queries to prevent accidentally returning 500+ time series. */
const enforceLimitRule: LintRule = {
  id: 'enforce-limit',
  description: 'Require LIMIT clause on all queries with GROUP BY',
  severity: 'warn',
  check(query) {
    if (query.groupBy && !query.limit) {
      return [{
        severity: 'warning',
        code: 'LINT_ENFORCE_LIMIT',
        message: 'Queries with GROUP BY should include LIMIT to control result size (max 500).',
        location: query.location,
      }];
    }
    return [];
  },
};

/** Warn on high LIMIT values near the AWS maximum. */
const maxLimitRule: LintRule = {
  id: 'max-limit',
  description: 'Warn when LIMIT is close to the 500 maximum (may return unexpected results)',
  severity: 'warn',
  check(query) {
    if (query.limit && query.limit.value > 100) {
      return [{
        severity: 'warning',
        code: 'LINT_MAX_LIMIT',
        message: `LIMIT ${query.limit.value} is high. Consider reducing to return only the most relevant results.`,
        location: query.limit.location,
      }];
    }
    return [];
  },
};

/** Detect SELECT COUNT without ORDER BY (ordering is useful). */
const countWithoutOrderRule: LintRule = {
  id: 'count-without-order',
  description: 'Suggest ORDER BY with COUNT() queries for meaningful top-N results',
  severity: 'warn',
  check(query) {
    if (query.select.function === 'COUNT' && !query.orderBy) {
      return [{
        severity: 'warning',
        code: 'LINT_COUNT_WITHOUT_ORDER',
        message: 'COUNT() queries without ORDER BY may return arbitrary time series. Consider adding ORDER BY COUNT().',
        location: query.select.location,
      }];
    }
    return [];
  },
};

/** Detect WHERE on non-SCHEMA dimension (may match unexpected metrics). */
const whereWithoutSchemaRule: LintRule = {
  id: 'where-without-schema',
  description: 'WHERE clauses on bare namespace queries may match unexpected dimension sets',
  severity: 'warn',
  check(query) {
    if (query.where && query.from.type === 'NamespaceFrom') {
      return [{
        severity: 'warning',
        code: 'LINT_WHERE_WITHOUT_SCHEMA',
        message: 'Using WHERE with bare namespace FROM may match metrics with unexpected dimension sets. Consider SCHEMA() with explicit dimensions.',
        location: query.where.location,
      }];
    }
    return [];
  },
};

/** Detect excessive GROUP BY dimensions (performance concern). */
const maxGroupByRule: LintRule = {
  id: 'max-group-by',
  description: 'Warn on GROUP BY with more than 3 dimensions (may produce excessive time series)',
  severity: 'warn',
  check(query) {
    if (query.groupBy && query.groupBy.items.length > 3) {
      return [{
        severity: 'warning',
        code: 'LINT_MAX_GROUP_BY',
        message: `GROUP BY with ${query.groupBy.items.length} dimensions may produce a very large number of time series.`,
        location: query.groupBy.location,
      }];
    }
    return [];
  },
};

/** Registry of all built-in rules with default severities. */
const BUILT_IN_RULES: LintRule[] = [
  { ...requireSchemaRule, severity: 'off' },
  { ...enforceLimitRule, severity: 'warn' },
  { ...maxLimitRule, severity: 'off' },
  { ...countWithoutOrderRule, severity: 'off' },
  { ...whereWithoutSchemaRule, severity: 'warn' },
  { ...maxGroupByRule, severity: 'warn' },
];

// ---- Linter ----

/**
 * Run all enabled linter rules against a parsed query.
 *
 * Built-in rules (configurable via {@link LinterOptions.rules}):
 * - `require-schema` — Prefer SCHEMA() over bare namespace (default: off)
 * - `enforce-limit` — Require LIMIT on GROUP BY queries (default: warn)
 * - `max-limit` — Warn on LIMIT > 100 (default: off)
 * - `count-without-order` — Suggest ORDER BY with COUNT() (default: off)
 * - `where-without-schema` — Warn on WHERE with bare namespace (default: warn)
 * - `max-group-by` — Warn on >3 GROUP BY dimensions (default: warn)
 *
 * @param query - The parsed query AST.
 * @param options - Optional rule configuration overriding default severities.
 * @returns Array of {@link ValidationMessage} objects for issues found.
 *
 * @example
 * ```ts
 * import { parse, lint } from '@agentix-e/aws-cw-miq-parser';
 *
 * const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId');
 * const issues = lint(ast);
 * // [{ severity: 'warning', code: 'LINT_ENFORCE_LIMIT', message: '...' }]
 * ```
 */
export function lint(query: ParsedQuery, options?: LinterOptions): ValidationMessage[] {
  const severities = options?.rules ?? {};
  const messages: ValidationMessage[] = [];

  for (const rule of BUILT_IN_RULES) {
    const severity = severities[rule.id] ?? rule.severity;
    if (severity === 'off') continue;

    const ruleMessages = rule.check(query);
    for (const msg of ruleMessages) {
      if (severity === 'error') {
        messages.push({ ...msg, severity: 'error' });
      } else {
        messages.push(msg);
      }
    }
  }

  return messages;
}

/**
 * Get the list of available linter rules with their default severities.
 *
 * @returns Array of rule descriptors with id, description, and defaultSeverity.
 *
 * @example
 * ```ts
 * import { listRules } from '@agentix-e/aws-cw-miq-parser';
 *
 * for (const rule of listRules()) {
 *   console.log(`${rule.id}: ${rule.description} [${rule.defaultSeverity}]`);
 * }
 * ```
 */
export function listRules(): { id: string; description: string; defaultSeverity: LintSeverity }[] {
  return BUILT_IN_RULES.map((r) => ({
    id: r.id,
    description: r.description,
    defaultSeverity: r.severity,
  }));
}
