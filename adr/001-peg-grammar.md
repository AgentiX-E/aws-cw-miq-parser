# ADR-001: PEG Grammar via Peggy for MIQ Parsing

- **Status**: Accepted
- **Date**: 2026-07-31
- **Author**: Lambertyan

## Context

We need to parse CloudWatch Metrics Insights (MIQ) query strings into structured, type-safe JSON ASTs. The query language has a fixed, well-defined syntax with approximately 50 grammar rules. Two viable approaches exist:

1. **Hand-written recursive descent parser**: Full control, no generator dependency, but more code to maintain and harder to keep in sync with spec changes.
2. **Parser generator (PEG via Peggy)**: Grammar-as-source, declarative, easy to audit against AWS spec, self-documenting.

## Decision

**Use Peggy (PEG.js successor) to generate the parser from a grammar file.**

## Rationale

- **Spec traceability**: The PEG grammar (`metrics-insights.pegjs`) serves as an executable specification. Each grammar rule directly maps to an AWS MIQ syntax rule, making compliance auditing straightforward.
- **Maintainability**: Grammar changes are localized to a single file. When AWS extends MIQ syntax, updating the parser requires modifying only the grammar.
- **Error reporting**: Peggy generates detailed syntax errors with expected tokens, source locations, and found tokens — exactly what we need for developer tooling.
- **Build-time dependency**: Peggy is a devDependency used only during `build:grammar`. The generated parser is a standalone JavaScript file with zero runtime dependencies on Peggy.
- **Performance**: Peggy generates backtracking-free parsers with memoization. Benchmarks show ~167K ops/sec for simple queries, well within acceptable range for a dev tool.
- **Ecosystem**: Peggy is the maintained successor to PEG.js, widely used in the JavaScript ecosystem (e.g., TypeScript, Markdown parsers).

## Trade-offs

- **Generated code opacity**: The generated parser (54.5 KB) is annotated with `@ts-nocheck` and `eslint-disable`. Debugging parse errors requires understanding the generator's output format. Mitigation: comprehensive error classification in `parser.ts` wraps Peggy errors into typed `ParseError` structures.
- **No incremental parsing**: Peggy generates batch parsers. For LSP use cases requiring incremental re-parsing, we would need to re-parse the entire query string. MIQ queries are limited to 4,096 characters, making full re-parse acceptable.

## Alternatives Considered

### Hand-written Recursive Descent
**Pros**: Full control, no generated code cruft, easier to produce custom error messages.  
**Cons**: More code to maintain (~500+ lines vs ~130 lines of grammar + generated output), harder to audit against spec, error recovery must be implemented manually.

### ANTLR4 with TypeScript target
**Pros**: Industry-standard parser generator, powerful grammar features.  
**Cons**: Heavy runtime dependency, complex setup, overkill for MIQ's simple syntax (no left recursion, no ambiguity).

### Tree-sitter
**Pros**: Incremental parsing, excellent for editors.  
**Cons**: Requires C compilation, overkill for a library, higher integration complexity.
