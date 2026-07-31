# Changelog

All notable changes to `@agentix-e/aws-cw-miq-parser` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Spec compliance matrix**: Complete mapping of 54 AWS MIQ syntax rules to parser implementation (`SPEC_COMPLIANCE.md`)
- **Conformance test suite**: 61 curated queries achieving 100% agreement rate, DeepSeek-powered AI query generation for coverage expansion
- **CommentAttachable on all AST nodes**: Per-node comment attachment via position-based distribution, full round-trip preservation through serialize
- **TypeDoc API documentation**: Automated API reference with CI deployment to GitHub Pages
- **Architecture Decision Records**: 3 ADRs documenting PEG grammar choice, comment distribution strategy, and conformance testing approach (`adr/`)
- **Migration guide**: Detailed instructions for migrating from Terraform, CloudFormation, AWS SDK, and Grafana (`MIGRATION.md`)
- **Codecov integration**: Coverage uploads with PR delta reporting
- **Changelog CI check**: PR validation ensuring CHANGELOG.md is updated

### Changed
- **Error classification**: Replaced fragile `includes()` substring matching with structured expected-token description matching and quoted-keyword message extraction
- **Recovery escape handling**: Fixed `maskQuotedContent` to correctly handle `\\'` (escaped-backslash) sequences via proper `\` toggle state tracking
- **Visitor safety**: Added defensive null-checks after visitor mutations (remove/replaceWith) to prevent NPE on deleted nodes
- **CI hardening**: Removed all `continue-on-error: true` from workflows

### Fixed
- **Visitor**: Root `visitQuery` now correctly triggered in `traverseWithPath` (previously unreachable)
- **Visitor**: Removed dead `visitNode` function
- **Serializer**: Trailing line comments (`--`) now properly append newline to avoid consuming subsequent clauses

## [0.5.0] — 2026-07-31

### Added
- **Core parser**: PEG-based parsing of CloudWatch Metrics Insights queries using Peggy
- **SELECT clause**: All 5 aggregation functions (AVG, COUNT, MAX, MIN, SUM) with case-insensitive matching
- **FROM clause**: Bare namespace and SCHEMA(table, dims...) variants
- **WHERE clause**: Dimension and tag filters with =, !=, <, <=, >, >= operators, AND/OR chaining
- **GROUP BY clause**: Multi-key grouping with tag key support
- **ORDER BY clause**: Aggregation function ordering with ASC/DESC direction
- **LIMIT clause**: Integer range 1–500 with semantic validation
- **Comment support**: Line comments (--) and block comments (/* */)
- **Tag dimensions**: `tag.keyName` and `tag."quoted:key"` syntax in WHERE and GROUP BY
- **Cross-account queries**: `AWS.AccountId` dimension and `CURRENT_ACCOUNT_ID()` function
- **Source locations**: Every AST node carries start/end position (line, column, offset)
- **Error diagnostics**: Column-precise error messages with source snippet and caret markers
- **Semantic validation**: LIMIT range checks, 700+ reserved keyword detection, SELECT/ORDER BY consistency warnings, duplicate GROUP BY detection, WHERE key vs SCHEMA dimensions
- **Serializer**: Round-trip conversion (ParsedQuery ↔ string) with semantic equivalence guarantee
- **Error recovery**: Multi-error collection via `parseWithRecovery()` (Babel-compatible)
- **Comment preservation**: Comments captured during lexing, preserved through parse→serialize round-trip
- **Zod runtime validation**: `validateAst()` and `safeValidateAst()` for AST structure checks
- **Query linter**: 6 configurable rules (require-schema, enforce-limit, max-limit, count-without-order, where-without-schema, max-group-by)
- **Enhanced visitor**: `traverseWithPath` + `NodePath` with parent navigation, skip(), stop(), replaceWith(), remove()
- **Cost estimator**: Heuristic cardinality analysis for 30+ dimension types with optimization recommendations
- **Autocomplete data**: LSP/Monaco-compatible completion items for keywords, functions, operators
- **CLI tool**: 5 subcommands (parse, validate, lint, serialize, format)
- **Property-based testing**: fast-check integration with 1M+ random iterations
- **Performance benchmarks**: vitest bench suite with sub-millisecond parse times
- **CI/CD pipeline**: Multi-Node.js matrix (18/20/22/24), fuzz testing, benchmarks, CLI smoke tests
- **Comprehensive test suite**: 632 tests, 99%+ line coverage, 95%+ branch coverage
- **Tree-shakeable subpath exports**: Independent imports for parser, validator, serializer, linter, visitor, etc.
- **Scenario guides**: CI/CD validation, Grafana migration, cost analysis, IDE diagnostics
