// Property-based tests for parser robustness.
// Uses fast-check to generate random queries and verify invariants.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../source/parser.js';
import { serialize } from '../../source/serializer.js';
import { validate } from '../../source/validator.js';
import {
  arbitrarySimpleQuery,
  arbitraryFullQuery,
  arbitraryConsistentQuery,
  arbitraryAnyString,
  arbitraryMalformedQuery,
} from './generators.js';

// Configuration: fast runs locally, exhaustive runs in CI
const isCI = (process.env['CI'] ?? 'false') === 'true';
const defaultNumRuns = isCI ? 100_000 : 5_000;
const extendedNumRuns = isCI ? 1_000_000 : 10_000;

describe('Property: round-trip', () => {
  it('parse(serialize(parse(q))) ≡ parse(q) for simple queries', () => {
    fc.assert(
      fc.property(arbitrarySimpleQuery(), (query) => {
        const first = parse(query);
        const serialized = serialize(first);
        const second = parse(serialized);

        expect(second.select.function).toBe(first.select.function);
        expect(second.select.metricName).toBe(first.select.metricName);
        expect(second.from.type).toBe(first.from.type);
        expect(second.from.namespace).toBe(first.from.namespace);
      }),
      { numRuns: defaultNumRuns },
    );
  }, 30000);

  it('round-trip for full queries', () => {
    fc.assert(
      fc.property(arbitraryFullQuery(), (query) => {
        const first = parse(query);
        const serialized = serialize(first);
        const second = parse(serialized);

        // Core structural equivalence
        expect(second.type).toBe(first.type);
        expect(second.select.function).toBe(first.select.function);
        expect(second.select.metricName).toBe(first.select.metricName);
        expect(second.from.type).toBe(first.from.type);
        expect(second.from.namespace).toBe(first.from.namespace);

        if (first.from.type === 'SchemaFrom' && second.from.type === 'SchemaFrom') {
          expect(second.from.dimensions).toEqual(first.from.dimensions);
        }

        // WHERE
        if (first.where) {
          expect(second.where).toBeDefined();
          expect(second.where!.conditions.length).toBe(first.where.conditions.length);
          for (let i = 0; i < first.where.conditions.length; i++) {
            const a = first.where.conditions[i]!;
            const b = second.where!.conditions[i]!;
            expect(b.labelKey).toBe(a.labelKey);
            expect(b.operator).toBe(a.operator);
            expect(b.labelValue).toBe(a.labelValue);
            expect(b.isTag).toBe(a.isTag);
          }
        } else {
          expect(second.where).toBeUndefined();
        }

        // GROUP BY
        if (first.groupBy) {
          expect(second.groupBy).toBeDefined();
          expect(second.groupBy!.items.length).toBe(first.groupBy.items.length);
          for (let i = 0; i < first.groupBy.items.length; i++) {
            expect(second.groupBy!.items[i]!.labelKey)
              .toBe(first.groupBy.items[i]!.labelKey);
          }
        }

        // ORDER BY
        if (first.orderBy) {
          expect(second.orderBy).toBeDefined();
          expect(second.orderBy!.function).toBe(first.orderBy.function);
          expect(second.orderBy!.direction).toBe(first.orderBy.direction);
        }

        // LIMIT
        if (first.limit) {
          expect(second.limit).toBeDefined();
          expect(second.limit!.value).toBe(first.limit.value);
        }
      }),
      { numRuns: defaultNumRuns },
    );
  }, 30000);
});

describe('Property: no-crash', () => {
  it('parser never throws unhandled error on any string', () => {
    fc.assert(
      fc.property(arbitraryAnyString(), (input) => {
        try {
          parse(input);
          // Either returns valid ParsedQuery or throws typed ParseError
        } catch (err: any) {
          // Must be a structured ParseError with location
          if (err.location) {
            expect(err.location.start).toBeDefined();
            expect(typeof err.message).toBe('string');
          } else if (err.message?.includes('parse(): input must be a string')) {
            // Type validation error is acceptable for non-string inputs
          } else {
            // Any other error is a bug
            throw err;
          }
        }
      }),
      { numRuns: extendedNumRuns },
    );
  }, 60000);
});

describe('Property: parse idempotence', () => {
  it('parsing the same query twice yields same result', () => {
    fc.assert(
      fc.property(arbitrarySimpleQuery(), (query) => {
        const first = parse(query);
        const second = parse(query);
        expect(second).toEqual(first);
      }),
      { numRuns: defaultNumRuns },
    );
  }, 15000);
});

describe('Property: validation consistency', () => {
  it('consistent queries produce no hard validation errors (excluding keyword collisions)', () => {
    fc.assert(
      fc.property(arbitraryConsistentQuery(), (query) => {
        const parsed = parse(query);
        const result = validate(parsed);
        // The only hard error from validator is reserved keywords or LIMIT range.
        // Our generator may randomly produce reserved keywords — exclude those.
        const criticalErrors = result.errors.filter(
          (e) => e.severity === 'error' && e.code !== 'SEM_RESERVED_KEYWORD'
        );
        expect(criticalErrors).toHaveLength(0);
      }),
      { numRuns: defaultNumRuns },
    );
  }, 15000);
});

describe('Property: error path safety', () => {
  it('malformed queries always produce structured errors', () => {
    fc.assert(
      fc.property(arbitraryMalformedQuery(), (input) => {
        try {
          parse(input);
          // If it succeeds, that's fine — the query might be valid
        } catch (err: any) {
          expect(err.location).toBeDefined();
          expect(typeof err.code).toBe('string');
          expect(['syntax', 'semantic', 'internal']).toContain(err.type);
        }
      }),
      { numRuns: defaultNumRuns },
    );
  }, 15000);
});
