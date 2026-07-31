# @agentix-e/aws-cw-miq-parser

> A TypeScript parser for AWS CloudWatch Metrics Insights queries. Transforms MIQ query strings into structured, type-safe JSON Abstract Syntax Trees (ASTs).

[![CI](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agentix-e/aws-cw-miq-parser?color=blue)](https://www.npmjs.com/package/@agentix-e/aws-cw-miq-parser)
[![Coverage](https://img.shields.io/badge/coverage-report-blue)](https://agentix-e.github.io/aws-cw-miq-parser/coverage/)
[![API Docs](https://img.shields.io/badge/docs-API-blue)](https://agentix-e.github.io/aws-cw-miq-parser/api/)
[![Benchmark Report](https://img.shields.io/badge/benchmark-latest-blue)](https://agentix-e.github.io/aws-cw-miq-parser/benchmark/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org/)

## Overview

**aws-cw-miq-parser** is the first and only dedicated CloudWatch Metrics Insights query parser for Node.js/TypeScript. It implements a compiler frontend architecture — PEG grammar → AST → validation → serialization — enabling static analysis, linting, transformation, and cost estimation of MIQ queries without AWS API calls.

### Architecture

```
Input String → [Lexer] → [Parser] → [Transformer] → ParsedQuery AST
                                                        ↓
                                              [Validator] → ValidationResult
                                                        ↓
                                              [Serializer] → Output String
                                                        ↓
                                              [Estimator]  → CostEstimate
```

### Key Features

- **Parse** Metrics Insights SQL → typed JSON AST with full source locations
- **Error recovery** — collect all syntax errors in one pass (Babel-compatible)
- **Comment preservation** — captured during lexing, preserved through round-trip
- **Serialize** JSON AST → valid MIQ query string with semantic equivalence
- **Validate** syntax and semantics (700+ reserved keywords, LIMIT range, cross-clause checks)
- **Zod runtime validation** — schema-based AST structure verification
- **Lint** queries with 6 configurable rules
- **Enhanced visitor** — NodePath API with `replaceWith()`, `remove()`, `skip()`, `stop()`
- **Cost estimation** — heuristic cardinality analysis for 30+ dimension types
- **Autocomplete data** — LSP-compatible completion items for IDE integration
- **CLI** — 5 subcommands for parse/validate/lint/serialize/format
- **Property-tested** with fast-check (1M+ random iterations)
- **Zero runtime parser dependencies** — Peggy is build-time only
- **632 tests**, 99%+ line coverage, 95%+ branch coverage
- **[Full AWS spec compliance matrix →](SPEC_COMPLIANCE.md)**

## Installation

```bash
npm install @agentix-e/aws-cw-miq-parser
# or
pnpm add @agentix-e/aws-cw-miq-parser
```

## Quick Start

```typescript
import { parse, serialize, validate } from '@agentix-e/aws-cw-miq-parser';

const query = `SELECT AVG(CPUUtilization)
  FROM SCHEMA("AWS/EC2", InstanceId)
  WHERE tag.env = 'prod'
  GROUP BY InstanceId
  ORDER BY AVG() DESC
  LIMIT 10`;

const ast = parse(query);
console.log(ast.select.function);   // 'AVG'
console.log(ast.select.metricName); // 'CPUUtilization'
console.log(ast.from.namespace);    // 'AWS/EC2'

const result = validate(ast);
if (!result.valid) console.error(result.errors);

const sql = serialize(ast);
```

## CLI

```bash
npx cw-miq parse query.miq      # Parse to JSON AST
npx cw-miq validate query.miq   # Validate syntax and semantics
npx cw-miq lint query.miq       # Lint for best practices
npx cw-miq format query.miq     # Pretty-print a query
npx cw-miq serialize query.miq  # Serialize AST back to SQL
```

## Scenario Guides

### CI/CD Pre-Deployment Validation

```typescript
import { parse, lint } from '@agentix-e/aws-cw-miq-parser';
import { readFileSync } from 'node:fs';

function validateIaCQueries(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const miqPattern = /expression\s*=\s*"([^"]+)"/g;
  let match, hasErrors = false;

  while ((match = miqPattern.exec(content)) !== null) {
    try {
      const ast = parse(match[1]!);
      const issues = lint(ast);
      if (issues.length > 0) console.warn(issues);
    } catch (err: any) {
      console.error(`Line ${err.location?.start?.line}: ${err.message}`);
      hasErrors = true;
    }
  }
  return !hasErrors;
}
```

### Grafana Dashboard Migration

```typescript
import { parse, serialize, traverseWithPath } from '@agentix-e/aws-cw-miq-parser';

function migrateDashboard(dashboard: any): any {
  for (const panel of dashboard.panels ?? []) {
    for (const target of panel.targets ?? []) {
      if (!target.expression) continue;
      try {
        const ast = parse(target.expression);
        traverseWithPath(ast, {
          visitFromClause(path) {
            if (path.node.type === 'NamespaceFrom') {
              path.replaceWith({
                type: 'SchemaFrom' as const,
                namespace: path.node.namespace,
                dimensions: [],
                location: path.node.location,
              });
            }
          },
        });
        target.expression = serialize(ast);
      } catch { /* skip unparseable */ }
    }
  }
  return dashboard;
}
```

### Query Cost Analysis

```typescript
import { parse, estimateCost } from '@agentix-e/aws-cw-miq-parser';

const ast = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) LIMIT 10');
const estimate = estimateCost(ast);

console.log(`Estimated metrics: ${estimate.metricCount.typical.toLocaleString()}`);
console.log(`Estimated cost: ${estimate.estimatedCost.typical}`);

for (const factor of estimate.factors) {
  const icon = factor.impact === 'increases' ? '⬆️' : factor.impact === 'reduces' ? '⬇️' : '➡️';
  console.log(`  ${icon} ${factor.clause}: ${factor.description}`);
}
```

## API Reference

### Core Parsing

#### `parse(input: string): ParsedQuery`
Parses a valid MIQ query string into a typed AST. Throws `ParseError` on first syntax error.

#### `parseWithRecovery(input: string): RecoveryResult`
Collects ALL syntax errors in one pass. Returns `{ ast, errors, comments }`.

### Serialization

#### `serialize(query: ParsedQuery, options?: SerializeOptions): string`
Round-trip conversion with `pretty`, `indent`, `uppercase` options. Preserves comments.

### Validation

#### `validate(query: ParsedQuery): ValidationResult`
Semantic checks: LIMIT range, 700+ reserved keywords, function consistency, duplicate GROUP BY.

#### `validateAst(data: unknown): ParsedQuery`
Zod runtime validation. Throws `ZodError` on invalid structure.

### Linting

#### `lint(query: ParsedQuery, options?: LinterOptions): ValidationMessage[]`

| Rule | Default | Description |
|---|---|---|
| `require-schema` | off | Prefer SCHEMA() over bare namespace |
| `enforce-limit` | warn | Require LIMIT on GROUP BY queries |
| `max-limit` | off | Warn on LIMIT > 100 |
| `count-without-order` | off | Suggest ORDER BY with COUNT() |
| `where-without-schema` | warn | Warn on WHERE with bare namespace |
| `max-group-by` | warn | Warn on >3 GROUP BY dimensions |

### Visitor & AST Mutation

#### `traverse(query: ParsedQuery, visitor: QueryVisitor): void`
Simple callback-based traversal (backward compatible).

#### `traverseWithPath(query: ParsedQuery, visitor: PathVisitor): void`
Enhanced traversal with `NodePath` — `parent`, `skip()`, `stop()`, `replaceWith(node)`, `remove()`.

### Cost Estimation

#### `estimateCost(query: ParsedQuery): CostEstimate`
Heuristic cardinality analysis. Returns metric counts, cost ranges, per-clause factors, and recommendations.

### Autocomplete Data

#### `getCompletions(context?: CompletionContext): CompletionItem[]`
LSP/Monaco-compatible completion items with context-sensitive suggestions.

### Tree-Shaking

```typescript
import { parse } from '@agentix-e/aws-cw-miq-parser/parser';
import { validate } from '@agentix-e/aws-cw-miq-parser/validator';
import { serialize } from '@agentix-e/aws-cw-miq-parser/serializer';
import { lint } from '@agentix-e/aws-cw-miq-parser/linter';
import { traverseWithPath } from '@agentix-e/aws-cw-miq-parser/visitor';
import { estimateCost } from '@agentix-e/aws-cw-miq-parser/cost';
import { getCompletions } from '@agentix-e/aws-cw-miq-parser/autocomplete';
import { parseWithRecovery } from '@agentix-e/aws-cw-miq-parser/recovery';
import { validateAst } from '@agentix-e/aws-cw-miq-parser/schema';
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

## Performance

Measured on Node.js 22:

| Scenario | Throughput | Latency (avg) |
|---|---|---|
| Simple query (41 chars) | ~167K ops/sec | ~0.006ms |
| Medium query (140 chars) | ~60K ops/sec | ~0.017ms |
| Complex query (160 chars) | ~53K ops/sec | ~0.019ms |
| Round-trip (parse + serialize) | ~86K ops/sec | ~0.012ms |

See the [latest benchmark report](https://agentix-e.github.io/aws-cw-miq-parser/benchmark/) for detailed results.

## Development

```bash
git clone https://github.com/AgentiX-E/aws-cw-miq-parser.git
cd aws-cw-miq-parser
pnpm install
pnpm run build:grammar
pnpm test
pnpm run test:property
pnpm run test:bench
pnpm run typecheck
```

## License

MIT — see [LICENSE](LICENSE) for details.
