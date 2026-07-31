# ADR-003: Conformance Testing Strategy

- **Status**: Accepted
- **Date**: 2026-07-31
- **Author**: Lambertyan

## Context

To claim spec compliance, we need evidence that the parser's acceptance/rejection behavior matches AWS CloudWatch Metrics Insights. The gold standard would be differential testing: send queries to AWS `GetMetricData` API and compare results with the parser.

However, AWS API differential testing requires:
- Valid AWS credentials with CloudWatch permissions
- A monitoring account with actual metrics to query
- API call latency and potential costs

These constraints make AWS API differential testing impractical for CI environments.

## Decision

**Use a two-tier conformance strategy: curated query set (always runs) + AI-generated query set (runs when DeepSeek API key is available).**

## Rationale

### Tier 1: Curated Query Set (61 queries, always runs)
- 45 valid queries covering every documented AWS MIQ syntax variant
- 14 invalid/edge-case queries for negative testing
- Hand-selected to include all 48 AWS official sample queries plus additional coverage of edge cases
- Runs in CI without any API keys
- Achieves 100% agreement rate (0 mismatches)

### Tier 2: AI-Generated Query Set (210 queries, DeepSeek-dependent)
- DeepSeek API generates diverse queries via structured prompts
- Covers valid syntax (100), invalid patterns (60), and edge cases (50)
- Results saved as JSON artifacts for audit trail
- Gracefully skipped when `DEEPSEEK_API_KEY` is unavailable
- Used for discovering parser gaps not covered by curated queries

## Parser-Only vs Full Validation Scope

The conformance test uses **parser-only acceptance** (`parse()` success/failure) rather than full semantic validation (`parse()` + `validate()`). Rationale:

- Parser correctness is about syntax recognition — can we build a structurally valid AST?
- Semantic validation (reserved keyword checks, LIMIT range, etc.) is a separate concern with its own comprehensive test suite
- AWS's own sample queries use unquoted reserved keywords (e.g., `Class`, `Resource`, `Type`) — the parser correctly handles these, even though the validator flags them
- Mixing parser and validator concerns in conformance testing would create false negatives

## Trade-offs

- **No live AWS differential testing**: We cannot guarantee 100% behavioral equivalence with AWS's parser. The curated query set provides high confidence but not formal proof.
- **DeepSeek dependency**: The AI-generated tier depends on an external API with rate limits and cost. It's designed as a supplementary check, not a gate.

## Future Work

When AWS credentials become available in CI:
1. Add a third tier that sends queries to `GetMetricData` API
2. Compare parser acceptance with AWS API response (success vs `InvalidMetricDataQuery` error)
3. Compute agreement rate and flag discrepancies

## Alternatives Considered

### Mock AWS API responses
**Rejected**: Mocking the API doesn't provide real differential testing value.

### Full semantic validation in conformance
**Rejected**: Would create false positives for valid AWS queries using unquoted reserved keyword dimension names.
