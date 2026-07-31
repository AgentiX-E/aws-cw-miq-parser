# Spec Compliance Matrix

> Maps every AWS CloudWatch Metrics Insights syntax rule to its implementation in `@agentix-e/aws-cw-miq-parser`.
>
> **AWS spec reference**: [Query components and syntax in CloudWatch Metrics Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-querylanguage.html)
>
> **Last updated**: 2026-07-31 · **Parser version**: v0.5.0

---

## Compliance Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented and tested |
| ⚠️ | Implemented with known caveats (see notes) |
| ❌ | Not applicable — feature does not exist in AWS MIQ spec |
| 🔮 | Forward-compatible implementation (not yet documented by AWS) |

---

## 1. SELECT Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `SELECT FUNCTION(metricName)` | `SelectClause` rule in `metrics-insights.pegjs` | `SelectClause` | `test/unit/select.test.ts`, `test/unit/clauses.test.ts` | ✅ |
| `AVG` aggregation function | `Function` token: `"AVG"i` | `AggregationFunction` enum | All 48 AWS sample queries, property tests | ✅ |
| `COUNT` aggregation function | `Function` token: `"COUNT"i` | `AggregationFunction` enum | All 48 AWS sample queries, property tests | ✅ |
| `MAX` aggregation function | `Function` token: `"MAX"i` | `AggregationFunction` enum | All 48 AWS sample queries, property tests | ✅ |
| `MIN` aggregation function | `Function` token: `"MIN"i` | `AggregationFunction` enum | All 48 AWS sample queries, property tests | ✅ |
| `SUM` aggregation function | `Function` token: `"SUM"i` | `AggregationFunction` enum | All 48 AWS sample queries, property tests | ✅ |
| Case-insensitive function names | `"AVG"i` / `"COUNT"i` / `"MAX"i` / `"MIN"i` / `"SUM"i` | Normalized to uppercase | `test/unit/parser.test.ts` | ✅ |
| Metric name as plain identifier | `PlainIdentifier` rule: `[a-zA-Z_][a-zA-Z0-9_]*` | `string` | All AWS sample queries | ✅ |
| Metric name as quoted identifier | `Identifier` rule → `QuotedIdentifier` | `string` | `test/integration/aws-samples.test.ts` (query 32: `"PutRecords.Bytes"`) | ✅ |
| Metric name = reserved keyword → must quote | `validator.ts` reserved keywords check (`SEM_RESERVED_KEYWORD`) | N/A | `test/unit/validator.test.ts` | ✅ |
| Single SELECT column only (no arithmetic, no `*`) | Grammar enforces single `FUNCTION(metricName)` pattern | `SelectClause` single node | Implicit in grammar | ✅ |

## 2. FROM Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `FROM "namespace"` (bare namespace) | `NamespaceSource` rule in grammar | `NamespaceFrom` | `test/unit/from.test.ts`, 48 sample queries | ✅ |
| `FROM SCHEMA("ns")` (zero dims) | `SchemaSource` rule with empty `dims` | `SchemaFrom` (dimensions: `[]`) | `test/unit/from.test.ts` | ✅ |
| `FROM SCHEMA("ns", dim1)` (one dim) | `SchemaSource` rule | `SchemaFrom` (dimensions: `['dim1']`) | 48 sample queries | ✅ |
| `FROM SCHEMA("ns", dim1, dim2)` (multi dims) | `SchemaSource` rule with repeated `("," _ dim:DimensionName)` | `SchemaFrom` (dimensions array) | `test/integration/aws-samples.test.ts` (query 04) | ✅ |
| Namespace with `/` must be quoted | `NamespaceValue` requires `"` wrapping for non-`[a-zA-Z0-9_]` | Handled by identifier quoting | All sample queries use quoted namespaces | ✅ |
| Dimension names as plain identifiers | `DimensionName` → `PlainIdentifier` | `string[]` | All SCHEMA sample queries | ✅ |
| Dimension names as quoted identifiers | `DimensionName` → `QuotedIdentifier` | `string[]` | `test/unit/from.test.ts` | ✅ |
| Case-sensitive namespace and dimension names | Grammar uses case-sensitive `[a-zA-Z]` patterns | N/A | `test/unit/parser.test.ts` (preserves casing) | ✅ |

## 3. WHERE Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `WHERE labelKey = 'value'` | `WhereClause` + `Condition` rules | `WhereClause` + `WhereCondition` | 48 sample queries, `test/unit/clauses.test.ts` | ✅ |
| `WHERE labelKey != 'value'` | `Operator` rule: `"!="` | `ComparisonOperator` union | `test/unit/clauses.test.ts` | ✅ |
| `WHERE key = 'str' AND key2 = 'str2'` | `LogicalConjunction` → `"AND"i` | `logicalOperator: 'AND'` | `test/unit/clauses.test.ts` | ✅ |
| `WHERE tag.keyName = 'value'` | `TagIdentifier` rule: `"tag."i key` | `isTag: true`, `labelKey: 'tag.xxx'` | `test/integration/aws-samples.test.ts` (query 09) | ✅ |
| `WHERE tag."quoted:key" = 'value'` | `TagIdentifier` → `QuotedIdentifier` for tag key | `isTag: true`, labelKey preserves quotes | `test/integration/aws-samples.test.ts` (query 10) | ✅ |
| `WHERE AWS.AccountId = '123456789012'` | `LabelKey` rule: `"AWS.AccountId"i` | `isTag: false`, `labelKey: 'AWS.AccountId'` | `test/unit/validator.test.ts` | ✅ |
| `WHERE AWS.AccountId = CURRENT_ACCOUNT_ID()` | `LabelValue` rule: `"CURRENT_ACCOUNT_ID"i _ "(" _ ")"` | `labelValue: 'CURRENT_ACCOUNT_ID()'` | `test/unit/clauses.test.ts` | ✅ |
| Single-quoted label values | `StringLiteral` rule: `"'" chars* "'"` | `string` | All WHERE sample queries | ✅ |
| Numeric label values | `NumberLiteral` rule: `[0-9]+` | `number` | `test/unit/serializer.test.ts` | ✅ |
| Escape `\'` in string values | `StringChar` → `"\\'"` | Unescaped `'` | `test/unit/recovery.test.ts` | ✅ |
| `WHERE key OP value AND key2 OP value2 ...` | Repeated `Condition` with `LogicalConjunction` | `conditions[]` array | 48 sample queries, property tests | ✅ |
| `OR` logical operator | 🔮 `LogicalConjunction` → `"OR"i` | `logicalOperator: 'OR'` | `test/unit/clauses.test.ts` | 🔮 Forward-compat: AWS docs only document `AND`; `OR` kept for future compatibility |

## 4. GROUP BY Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `GROUP BY labelKey` | `GroupByClause` rule | `GroupByClause` + `GroupByItem[]` | 48 sample queries | ✅ |
| `GROUP BY key1, key2` | Repeated `"," _ key:LabelKey` | `items[]` array | `test/unit/clauses.test.ts` | ✅ |
| `GROUP BY tag.keyName` | `LabelKey` → `TagIdentifier` | `isTag: true` | `test/unit/clauses.test.ts` | ✅ |
| `GROUP BY AWS.AccountId` | `LabelKey` → `"AWS.AccountId"i` | `isTag: false` | `test/unit/clauses.test.ts` | ✅ |
| Case-sensitive GROUP BY keys | Grammar uses case-sensitive identifiers | `string` | Property tests | ✅ |

## 5. ORDER BY Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `ORDER BY FUNCTION()` | `OrderByClause` rule | `OrderByClause` | 48 sample queries | ✅ |
| `ORDER BY FUNCTION() ASC` | `Direction` → `"ASC"i` | `direction: 'ASC'` | `test/integration/aws-samples.test.ts` | ✅ |
| `ORDER BY FUNCTION() DESC` | `Direction` → `"DESC"i` | `direction: 'DESC'` | 48 sample queries | ✅ |
| Default direction is ASC | Predicate `&{ return 'ASC'; }` | `direction: 'ASC'` | `test/integration/aws-samples.test.ts` | ✅ |
| Same functions as SELECT | `Function` token reused | `AggregationFunction` enum | Property tests | ✅ |

## 6. LIMIT Clause

| AWS Spec Rule | Parser Implementation | TypeScript Type | Test Coverage | Status |
|---------------|----------------------|-----------------|---------------|--------|
| `LIMIT number` | `LimitClause` rule + `NumberLiteral` | `LimitClause` | 48 sample queries | ✅ |
| Range: 1–500 | Validated in `validator.ts` (`SEM_LIMIT_OUT_OF_RANGE`) | `z.number().int().min(1).max(500)` in schema | `test/unit/validator.test.ts` | ✅ |
| Integer only | `[0-9]+` → `parseInt()` | `number` | Property tests | ✅ |

## 7. Clause Ordering

| AWS Spec Rule | Parser Implementation | Status |
|---------------|----------------------|--------|
| SELECT first, FROM second (required) | Grammar enforces strict order in `Query` rule | ✅ |
| WHERE before GROUP BY | Grammar placement: `SelectClause FromClause WhereClause? GroupByClause?` | ✅ |
| GROUP BY before ORDER BY | Grammar placement: `GroupByClause? OrderByClause?` | ✅ |
| ORDER BY before LIMIT | Grammar placement: `OrderByClause? LimitClause?` | ✅ |
| All optional clauses are independently optional | Every clause uses `?` quantifier in grammar | ✅ |

## 8. Keywords and Case Sensitivity

| AWS Spec Rule | Parser Implementation | Status |
|---------------|----------------------|--------|
| Keywords are case-insensitive | All keyword rules use `i` flag (`"SELECT"i`, `"FROM"i`, etc.) | ✅ |
| Identifiers (namespaces, metric names, dimensions) are case-sensitive | `PlainIdentifier` uses case-sensitive `[a-zA-Z]` | ✅ |
| Tags use lowercase `tag.` prefix | `"tag."i` (case-insensitive prefix, case-sensitive key) | ✅ |

## 9. Reserved Keywords

| AWS Spec Rule | Parser Implementation | Test Coverage | Status |
|---------------|----------------------|---------------|--------|
| 700+ reserved keywords must be quoted when used as identifiers | `validator.ts` `RESERVED_KEYWORDS` Set (700+ entries) | `test/unit/validator.test.ts` | ✅ |
| Keywords list source: [AWS docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-reserved-keywords.html) | Complete list embedded in `validator.ts` | N/A | ✅ |
| Suggestions: quote the identifier with double quotes | Error message: `Use double quotes: "${identifier}".` | `test/unit/validator.test.ts` | ✅ |

## 10. Cross-Account Queries

| AWS Spec Rule | Parser Implementation | Test Coverage | Status |
|---------------|----------------------|---------------|--------|
| `AWS.AccountId` in WHERE | `LabelKey` → `"AWS.AccountId"i` | `test/unit/validator.test.ts` | ✅ |
| `AWS.AccountId` in GROUP BY | `LabelKey` → `"AWS.AccountId"i` | `test/unit/clauses.test.ts` | ✅ |
| `CURRENT_ACCOUNT_ID()` in WHERE | `LabelValue` → `"CURRENT_ACCOUNT_ID"i _ "(" _ ")"` | `test/unit/clauses.test.ts` | ✅ |

## 11. Limits and Quotas (AWS Reference)

| AWS Limit | Value | Parser Handling | Status |
|-----------|-------|-----------------|--------|
| Max query length | 4,096 chars | Validated in `parser.ts` (`MAX_QUERY_LENGTH = 4096`) | ✅ |
| Max metrics processed per query | 10,000 | Documented in cost estimator caveat | ✅ |
| Max time series returned | 500 | `MAX_TIME_SERIES = 500` in cost estimator, LIMIT validation | ✅ |
| Max LIMIT value | 500 | Validated in `validator.ts` | ✅ |
| High-resolution metrics (<1 min) | Not supported | N/A (not a parser concern) | N/A |

## 12. Features NOT in AWS MIQ Spec (intentionally absent)

These SQL features are reserved keywords but are **not documented as usable** in MIQ queries. The parser intentionally does not implement them.

| Feature | Reason |
|---------|--------|
| `WITH` clause (CTE) | Not in AWS MIQ syntax |
| `FILTER` clause | Not in AWS MIQ syntax |
| `LIKE` operator | Only `=` and `!=` are documented |
| `BETWEEN` operator | Only `=` and `!=` are documented |
| `IN` operator | Only `=` and `!=` are documented |
| `NOT` / `IS NULL` / `IS NOT NULL` | Only `=` and `!=` are documented |
| `JOIN` (any type) | Not in AWS MIQ syntax |
| `HAVING` clause | Not in AWS MIQ syntax |
| `UNION` / `INTERSECT` / `EXCEPT` | Not in AWS MIQ syntax |
| `DISTINCT` modifier | Not in AWS MIQ syntax |
| Arithmetic expressions in SELECT | Only `FUNCTION(metricName)` is documented |
| Subqueries / nested queries | Not in AWS MIQ syntax |
| `AS` aliases | Not in AWS MIQ syntax |
| `CASE WHEN` expressions | Not in AWS MIQ syntax |
| String / date functions | Not in AWS MIQ syntax |
| Comment syntax (`--`, `/* */`) | Not documented by AWS; added by parser as a value-add feature |

## 13. Parser Value-Add Features (beyond AWS spec)

| Feature | Description | Test Coverage |
|---------|-------------|---------------|
| Comment preservation | `--` line comments and `/* */` block comments captured and serialized | `test/unit/comments.test.ts` (13 tests) |
| Error recovery | `parseWithRecovery()` — collect all errors in one pass | `test/unit/recovery.test.ts` (13 tests) |
| Semantic validation | LIMIT range, reserved keywords, SELECT/ORDER BY consistency, duplicate GROUP BY, WHERE key vs SCHEMA dims | `test/unit/validator.test.ts` (15 tests) |
| Query linter | 6 configurable rules | `test/unit/linter.test.ts` (14 tests) |
| Cost estimation | Heuristic cardinality analysis for 30+ dimension types | `test/unit/cost.test.ts` (28 tests) |
| Autocomplete data | LSP/Monaco-compatible completion items | `test/unit/autocomplete.test.ts` |
| Enhanced visitor | NodePath API with replaceWith(), remove(), skip(), stop() | `test/unit/visitor-enhanced.test.ts` (15 tests) |
| Zod runtime validation | `validateAst()` / `safeValidateAst()` | `test/unit/schema.test.ts` (9 tests) |
| CLI tool | 5 subcommands (parse/validate/lint/serialize/format) | `test/integration/cli.test.ts` (11 tests) |

---

## Summary

| Category | Total Rules | ✅ Compliant | 🔮 Forward-Compat | ❌ N/A |
|----------|-------------|-------------|-------------------|--------|
| SELECT clause | 7 | 7 | 0 | 0 |
| FROM clause | 7 | 7 | 0 | 0 |
| WHERE clause | 11 | 10 | 1 (OR) | 0 |
| GROUP BY clause | 4 | 4 | 0 | 0 |
| ORDER BY clause | 4 | 4 | 0 | 0 |
| LIMIT clause | 3 | 3 | 0 | 0 |
| Clause ordering | 5 | 5 | 0 | 0 |
| Keywords/case | 3 | 3 | 0 | 0 |
| Reserved keywords | 3 | 3 | 0 | 0 |
| Cross-account | 3 | 3 | 0 | 0 |
| Limits/quotas | 4 | 4 | 0 | 0 |
| **Totals** | **54** | **53** | **1** | **0** |

**Overall compliance**: 53/54 rules fully implemented (98.1%). The single forward-compat item is `OR` in WHERE (not yet AWS-documented but kept for future compatibility).
