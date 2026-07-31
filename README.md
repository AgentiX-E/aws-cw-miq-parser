# @agentix/aws-cw-miq-parser

A TypeScript parser for **AWS CloudWatch Metrics Insights** queries. Transforms MIQ query strings into structured, type-safe JSON Abstract Syntax Trees (ASTs).

[![CI](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- **Parse** Metrics Insights SQL queries → typed JSON AST with full source locations
- **Error recovery** — collect all syntax errors in one pass (Babel-style multi-error mode)
- **Comment preservation** — comments captured during lexing, preserved through round-trip
- **Serialize** JSON AST → valid MIQ query string (semantic equivalence guarantee)
- **Validate** syntax and semantics (700+ reserved keywords, LIMIT range, cross-clause consistency)
- **Zod runtime validation** — `validateAst()` for runtime AST structure checks
- **Lint** queries with 6 configurable rules
- **Enhanced visitor** — `traverseWithPath` + `NodePath` with `skip()`, `stop()`, `replaceWith()`, `remove()`
- **Cost estimator** — heuristic cardinality analysis with optimization recommendations
- **Autocomplete data** — keyword/function/operator exports for LSP integrations
- **CLI** — 5 subcommands for parse/validate/lint/serialize/format
- **Property-tested** with fast-check (1M+ random iterations)
- **Zero runtime parser dependencies** (Peggy is build-time only)
- **TypeScript-first** with strict mode and exhaustive type definitions
- **ESM-only** for Node.js 18+, Deno, Bun, and modern bundlers
- **632 tests**, 99%+ line coverage, 95%+ branch coverage

## Installation

```bash
npm install @agentix/aws-cw-miq-parser
# or
pnpm add @agentix/aws-cw-miq-parser
```

## Quick Start

```typescript
import { parse, serialize, validate } from '@agentix/aws-cw-miq-parser';

const query = `SELECT AVG(CPUUtilization)
  FROM SCHEMA("AWS/EC2", InstanceId)
  WHERE tag.env = 'prod'
  GROUP BY InstanceId
  ORDER BY AVG() DESC
  LIMIT 10`;

// Parse → structured JSON AST
const ast = parse(query);
console.log(ast.select.function);   // 'AVG'
console.log(ast.select.metricName); // 'CPUUtilization'
console.log(ast.from.namespace);    // 'AWS/EC2'
console.log(ast.from.dimensions);   // ['InstanceId']

// Validate
const result = validate(ast);
if (!result.valid) {
  console.error(result.errors);
}

// Serialize back to SQL
const sql = serialize(ast);
console.log(sql);
```

## CLI

```bash
# Parse a query file to JSON AST
npx cw-miq parse query.miq

# Validate a query
npx cw-miq validate query.miq

# Lint for best practices
npx cw-miq lint query.miq

# Pretty-print a query
npx cw-miq format query.miq

# Serialize JSON AST back to SQL
npx cw-miq serialize query.miq
```

## Scenario Guides

### 1. CI/CD Pre-Deployment Validation

Validate Metrics Insights queries embedded in Terraform or CloudFormation before deployment:

```typescript
import { parse, lint } from '@agentix/aws-cw-miq-parser';
import { readFileSync } from 'node:fs';

// Extract MIQ queries from IaC files and validate
function validateIaCQueries(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const miqPattern = /expression\s*=\s*"([^"]+)"/g;
  let match, hasErrors = false;

  while ((match = miqPattern.exec(content)) !== null) {
    const query = match[1]!;
    try {
      const ast = parse(query);
      const issues = lint(ast);
      if (issues.length > 0) {
        console.warn(`Lint issues in ${filePath}:`, issues);
      }
    } catch (err: any) {
      console.error(`Invalid MIQ query at ${filePath}:${err.location?.start?.line}: ${err.message}`);
      hasErrors = true;
    }
  }
  return !hasErrors;
}

// Use in your CI pipeline
if (!validateIaCQueries('main.tf')) {
  process.exit(1);
}
```

### 2. Grafana Dashboard Migration

Transform Grafana CloudWatch data source queries for migration or analysis:

```typescript
import { parse, serialize, traverseWithPath } from '@agentix/aws-cw-miq-parser';

// Rewrite all queries in a Grafana JSON model to use SCHEMA()
function migrateGrafanaDashboard(dashboard: any): any {
  for (const panel of dashboard.panels ?? []) {
    for (const target of panel.targets ?? []) {
      if (target.expression) {
        try {
          const ast = parse(target.expression);

          // Transform bare namespace → SCHEMA with dimensions
          traverseWithPath(ast, {
            visitFromClause(path) {
              if (path.node.type === 'NamespaceFrom') {
                const schemaFrom = {
                  type: 'SchemaFrom' as const,
                  namespace: path.node.namespace,
                  dimensions: [],
                  location: path.node.location,
                };
                path.replaceWith(schemaFrom);
              }
            },
          });

          target.expression = serialize(ast);
        } catch { /* skip unparseable queries */ }
      }
    }
  }
  return dashboard;
}
```

### 3. Query Cost Analysis

Estimate the cost of Metrics Insights queries before execution:

```typescript
import { parse, estimateCost } from '@agentix/aws-cw-miq-parser';

function analyzeQueryCost(query: string): void {
  const ast = parse(query);
  const estimate = estimateCost(ast);

  console.log(`Estimated metrics matched: ${estimate.metricCount.typical.toLocaleString()}`);
  console.log(`Estimated cost: ${estimate.estimatedCost.typical}`);

  // Cost factors
  for (const factor of estimate.factors) {
    const icon = factor.impact === 'increases' ? '⬆️' : factor.impact === 'reduces' ? '⬇️' : '➡️';
    console.log(`  ${icon} ${factor.clause}: ${factor.description}`);
  }

  // Recommendations
  for (const rec of estimate.recommendations) {
    console.warn(`  [${rec.severity.toUpperCase()}] ${rec.message}`);
  }
}

analyzeQueryCost('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) GROUP BY InstanceId LIMIT 10');
```

### 4. Error Recovery in IDE Tooling

Collect all syntax errors for editor diagnostics:

```typescript
import { parseWithRecovery } from '@agentix/aws-cw-miq-parser';

function getDiagnostics(query: string) {
  const result = parseWithRecovery(query);

  return result.errors.map((err) => ({
    line: err.location.start.line,
    column: err.location.start.column,
    message: err.message,
    code: err.code,
    severity: 'error',
  }));
}

// Returns ALL errors at once (not just the first)
const diagnostics = getDiagnostics('SELECT FOO(x) FROM INVALID GROUP BY ORDER BY LIMIT abc');
console.log(diagnostics.length); // multiple errors
```

## API Reference

### Core Parsing

#### `parse(input: string): ParsedQuery`

Parses a valid MIQ query string into a typed AST. Throws `ParseError` with source location on first syntax error.

#### `parseWithRecovery(input: string): RecoveryResult`

Advanced parser that collects ALL syntax errors in one pass. Returns `{ ast: ParsedQuery | null, errors: ParseError[], comments: Comment[] }`. The partial AST contains successfully parsed clauses even when others fail.

### Serialization

#### `serialize(query: ParsedQuery, options?: SerializeOptions): string`

Converts `ParsedQuery` AST back to a valid MIQ query string. Options: `pretty`, `indent`, `uppercase`. Preserves comments when present. Guarantees `parse(serialize(parse(q))) ≡ parse(q)`.

### Validation

#### `validate(query: ParsedQuery): ValidationResult`

Semantic validation: LIMIT range (1–500), 700+ reserved keyword detection, SELECT/ORDER BY function consistency, duplicate GROUP BY, WHERE key vs SCHEMA dimensions.

#### `validateAst(data: unknown): ParsedQuery`

Zod runtime validation of AST structure. Throws `ZodError` on invalid data. Useful for validating serialized/deserialized ASTs.

#### `safeValidateAst(data: unknown): { success, data } | { success, error }`

Non-throwing variant. Returns discriminated union for type-safe error handling.

### Linting

#### `lint(query: ParsedQuery, options?: LinterOptions): ValidationMessage[]`

Configurable linter with 6 rules:

| Rule | Default | Description |
|---|---|---|
| `require-schema` | off | Prefer SCHEMA() over bare namespace |
| `enforce-limit` | warn | Require LIMIT on GROUP BY queries |
| `max-limit` | off | Warn on LIMIT > 100 |
| `count-without-order` | off | Suggest ORDER BY with COUNT() |
| `where-without-schema` | warn | Warn on WHERE with bare namespace |
| `max-group-by` | warn | Warn on >3 GROUP BY dimensions |

```typescript
import { lint } from '@agentix/aws-cw-miq-parser';
const messages = lint(ast, { rules: { 'require-schema': 'warn' } });
```

### Visitor & AST Mutation

#### `traverse(query: ParsedQuery, visitor: QueryVisitor): void`

Simple callback-based traversal (backward compatible). Each node type has an optional callback.

#### `traverseWithPath(query: ParsedQuery, visitor: PathVisitor): void`

Enhanced traversal with `NodePath` context providing:

- `path.parent` / `path.parentKey` / `path.listKey` — parent navigation
- `path.skip()` — skip children of the current node
- `path.stop()` — immediately halt all traversal
- `path.replaceWith(newNode)` — replace node in-place in its parent
- `path.remove()` — remove node from its parent (works on arrays and optional fields)

```typescript
import { parse, traverseWithPath } from '@agentix/aws-cw-miq-parser';

const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE a = \'1\' AND b = \'2\'');

// Remove all WHERE conditions with key 'b'
traverseWithPath(ast, {
  visitWhereCondition(path) {
    if (path.node.labelKey === 'b') {
      path.remove(); // removes from parent's conditions array
    }
  },
});
```

### Cost Estimation

#### `estimateCost(query: ParsedQuery): CostEstimate`

Heuristic cost estimation based on dimension cardinalities and AWS pricing ($0.01/1,000 metrics):

- `metricCount: { low, typical, high }` — cardinality estimates
- `estimatedCost: { low, typical, high }` — cost range in USD
- `limitBound: number | null` — effective upper bound from LIMIT
- `factors: CostFactor[]` — per-clause cost impact analysis
- `recommendations: CostRecommendation[]` — actionable optimization tips
- `caveat: string` — honest disclaimer about heuristic nature

```typescript
import { parse, estimateCost } from '@agentix/aws-cw-miq-parser';

const ast = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) LIMIT 10');
const estimate = estimateCost(ast);
console.log(estimate.estimatedCost.typical); // '$0.01'
```

### Autocomplete Data

#### `getCompletions(context?: CompletionContext): CompletionItem[]`

Returns LSP/Monaco-compatible completion items. Context-sensitive: provides operator suggestions in WHERE, direction suggestions in ORDER BY.

#### `getAllKeywords(): string[]` / `getFunctionNames(): string[]`

Flat arrays of all MIQ keywords and aggregation function names for syntax highlighting.

```typescript
import { getCompletions, getAllKeywords } from '@agentix/aws-cw-miq-parser';

// For syntax highlighting
const keywords = getAllKeywords(); // ['SELECT', 'FROM', 'AVG', ...]

// For autocomplete at cursor position
const items = getCompletions({
  textBeforeCursor: 'WHERE ',
  fullText: queryString,
  cursorOffset: 50,
});
```

### Error Formatting

#### `formatError(source: string, error: ParseError): string`

Plain-text error with source snippet and column-precise caret markers.

#### `formatTerminalError(source: string, error: ParseError): Promise<string>`

Colorized terminal output using ANSI escape codes (requires `chalk`).

### Tree-Shaking

Import only what you need:

```typescript
import { parse } from '@agentix/aws-cw-miq-parser/parser';
import { validate } from '@agentix/aws-cw-miq-parser/validator';
import { serialize } from '@agentix/aws-cw-miq-parser/serializer';
import { lint, listRules } from '@agentix/aws-cw-miq-parser/linter';
import { traverseWithPath } from '@agentix/aws-cw-miq-parser/visitor';
import { estimateCost } from '@agentix/aws-cw-miq-parser/cost';
import { getCompletions } from '@agentix/aws-cw-miq-parser/autocomplete';
import { parseWithRecovery } from '@agentix/aws-cw-miq-parser/recovery';
import { validateAst } from '@agentix/aws-cw-miq-parser/schema';
```

## Supported Query Syntax

| Clause | Syntax | Example |
|---|---|---|
| **SELECT** | `FUNCTION(metricName)` | `SELECT AVG(CPUUtilization)` |
| **FROM** | `"namespace"` or `SCHEMA("ns", dims...)` | `FROM SCHEMA("AWS/EC2", InstanceId)` |
| **WHERE** | `key OP value [AND\|OR ...]` | `WHERE tag.env = 'prod' AND InstanceType != 't2.micro'` |
| **GROUP BY** | `key [, key...]` | `GROUP BY InstanceId, tag.team` |
| **ORDER BY** | `FUNCTION() [ASC\|DESC]` | `ORDER BY MAX() DESC` |
| **LIMIT** | `number` (1–500) | `LIMIT 10` |

**Functions**: `AVG`, `COUNT`, `MAX`, `MIN`, `SUM`  
**Operators**: `=`, `!=`, `<`, `<=`, `>`, `>=`  
**Special**: `tag.xxx` keys, `AWS.AccountId`, `CURRENT_ACCOUNT_ID()`

Keywords are case-insensitive. Identifiers (namespaces, metric names, dimensions) are case-sensitive.

## Design

The parser follows a compiler frontend architecture:

```
Input String → [Lexer] → [Parser] → [Transformer] → ParsedQuery AST
                                                        ↓
                                              [Validator] → ValidationResult
                                                        ↓
                                              [Serializer] → Output String
```

- **Grammar**: PEG (Parsing Expression Grammar) via Peggy — ~300 lines, self-documenting
- **Parser**: Pre-compiled at build time into a standalone ~54KB JavaScript module
- **Types**: Exhaustive TypeScript interfaces with `SourceLocation` on every node
- **Errors**: Column-precise diagnostics with source snippet and caret markers
- **Error recovery**: Per-clause recovery collects all errors in one pass (Babel-compatible)
- **Comments**: Captured during lexing, preserved through parse→serialize round-trip
- **AST mutation**: `NodePath` API with `replaceWith()`, `remove()`, `skip()`, `stop()`

## Performance

Measured on Node.js 22:

| Scenario | Throughput | Latency (avg) |
|---|---|---|
| Simple query (41 chars) | ~167K ops/sec | ~0.006ms |
| Medium query (140 chars) | ~60K ops/sec | ~0.017ms |
| Complex query (160 chars) | ~53K ops/sec | ~0.019ms |
| Round-trip (parse + serialize) | ~86K ops/sec | ~0.012ms |

Zero heap allocations beyond the AST itself.

## Development

```bash
git clone https://github.com/AgentiX-E/aws-cw-miq-parser.git
cd aws-cw-miq-parser
pnpm install
pnpm run build:grammar   # Compile PEG grammar
pnpm test                # Run 630+ tests
pnpm run test:property   # Run property-based tests (fuzz)
pnpm run test:bench      # Run benchmarks
pnpm run typecheck       # TypeScript type checking
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Related

- [Internal Documentation](https://github.com/AgentiX-E/aws-cw-miq-parser-docs) — Design docs, whitepaper, knowledge dictionary, audit reports
- [AWS Metrics Insights Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-querylanguage.html)
