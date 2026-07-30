# @agentix/aws-cw-miq-parser

A TypeScript parser for **AWS CloudWatch Metrics Insights** queries. Transforms MIQ query strings into structured, type-safe JSON Abstract Syntax Trees (ASTs).

[![CI](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/aws-cw-miq-parser/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agentix/aws-cw-miq-parser)](https://www.npmjs.com/package/@agentix/aws-cw-miq-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- **Parse** Metrics Insights SQL queries → typed JSON AST
- **Serialize** JSON AST → valid MIQ query string (round-trip fidelity)
- **Validate** syntax and semantics (700+ reserved keywords, LIMIT range, cross-clause checks)
- **Lint** queries with configurable rules (SCHEMA enforcement, LIMIT requirements, etc.)
- **Visitor** API for AST traversal
- **Property-tested** with fast-check (1M+ random iterations)
- **Zero runtime parser dependencies** (Peggy is build-time only)
- **TypeScript-first** with strict mode and exhaustive type definitions
- **ESM-only** for Node.js 18+, Deno, Bun, and modern bundlers

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

## API Reference

### `parse(input: string): ParsedQuery`

Parses a Metrics Insights query string into a typed AST. Throws `ParseError` with source location on invalid syntax.

### `serialize(query: ParsedQuery, options?: SerializeOptions): string`

Converts a `ParsedQuery` AST back to a valid MIQ query string. Supports `pretty: boolean`, `indent: number`, and `uppercase: boolean` options. Guarantees `parse(serialize(parse(q))) ≡ parse(q)`.

### `validate(query: ParsedQuery): ValidationResult`

Runs semantic validation: LIMIT range (1–500), reserved keyword detection (700+ words), SELECT/ORDER BY function consistency, duplicate GROUP BY detection, WHERE key vs SCHEMA dimensions.

### `lint(query: ParsedQuery, options?: LinterOptions): ValidationMessage[]`

Runs configurable linter rules:
- `require-schema` — Prefer SCHEMA() over bare namespace (off by default)
- `enforce-limit` — Require LIMIT on GROUP BY queries (warn by default)
- `max-limit` — Warn on high LIMIT values (off by default)
- `count-without-order` — Suggest ORDER BY with COUNT() (off by default)
- `where-without-schema` — Warn on WHERE with bare namespace (warn by default)
- `max-group-by` — Warn on >3 GROUP BY dimensions (warn by default)

### `traverse(query: ParsedQuery, visitor: QueryVisitor): void`

Walks the AST with callbacks for each node type. Implement only the methods you need.

### `formatError(source: string, error: ParseError): string`

Formats a ParseError with source snippet and column-precise caret markers.

### Tree-Shaking

Import only what you need:

```typescript
import { parse } from '@agentix/aws-cw-miq-parser/parser';
import { validate } from '@agentix/aws-cw-miq-parser/validator';
import { serialize } from '@agentix/aws-cw-miq-parser/serializer';
import { lint, listRules } from '@agentix/aws-cw-miq-parser/linter';
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

- **Grammar**: PEG (Parsing Expression Grammar) via Peggy — ~250 lines, self-documenting
- **Parser**: Pre-compiled at build time into a standalone ~52KB JavaScript module
- **Types**: Exhaustive TypeScript interfaces with `SourceLocation` on every node
- **Errors**: Column-precise diagnostics with source snippet and caret markers

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
pnpm test                # Run 500+ tests
pnpm run test:property   # Run property-based tests
pnpm run test:bench      # Run benchmarks
pnpm run typecheck       # TypeScript type checking
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Related

- [Internal Documentation](https://github.com/AgentiX-E/aws-cw-miq-parser-docs) — Design docs, whitepaper, knowledge dictionary
- [AWS Metrics Insights Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-querylanguage.html)
