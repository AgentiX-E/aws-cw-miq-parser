# ADR-002: Comment Distribution Strategy

- **Status**: Accepted
- **Date**: 2026-07-31
- **Author**: Lambertyan

## Context

CloudWatch Metrics Insights queries can contain SQL-style comments (`-- line` and `/* block */`). While AWS does not document comment support, adding it as a value-add feature enables use cases like query documentation, CI pipeline annotations, and formatted output preservation.

The parser must capture comments during lexing and re-emit them during serialization. The key design question: **how to attach comments to AST nodes?**

## Decision

**Use position-based distribution (offset comparison) to attach comments to the nearest preceding AST clause node.**

## Rationale

- **Simplicity**: Comments are collected globally during lexing with their source locations. After all clauses are parsed, a single post-processing pass (`distributeComments()`) assigns each comment to the clause node whose start offset is the greatest value less than the comment's offset.
- **No grammar changes**: The PEG grammar's comment handling rules (`LineComment`, `BlockComment`) remain unchanged. They collect comments into a global buffer. The distribution happens only in the root `Query` rule.
- **Deterministic**: Each comment is assigned to exactly one node based on offset comparison. No ambiguity.
- **Compatible with partial parsing**: Error recovery mode (`parseWithRecovery()`) can also use this strategy if needed in the future.

## Implementation

Comments flow through three stages:

1. **Lexing**: `LineComment` and `BlockComment` PEG rules push `{ type, text, location }` objects to a `collectedComments` array.
2. **Distribution**: In the `Query` rule, `distributeComments(rootNode, clauses)` sorts comments by offset, sorts clauses by offset, and assigns each comment to the latest clause that starts before it.
3. **Serialization**: `serialize()` outputs root-level `leadingComments` before SELECT, then calls `appendComments()` after each clause to emit its `trailingComments`.

Comments that appear after the last clause become `trailingComments` on the root `ParsedQuery` node.

Comments between clause A and clause B become `trailingComments` on clause A.

## Trade-offs

- **No intra-clause comments**: Comments within a clause (e.g., `SELECT AVG(/* metric */ CPUUtilization)`) are collected but may not be perfectly reconstructed. This is acceptable since MIQ queries are single-line by convention.
- **Line comment newline requirement**: In single-line serialization mode, trailing line comments (`--`) must be followed by a `\n` to prevent consuming the next clause. The serializer handles this automatically.

## Alternatives Considered

### Per-node comment collection (grammar-level)
Each grammar rule collects its own preceding comments.  
**Rejected**: Would require significant grammar changes and complicate rule definitions.

### CST (Concrete Syntax Tree) approach
Preserve all whitespace and comments as CST nodes.  
**Rejected**: Overkill for MIQ's simple structure. Adds complexity without proportional benefit.
