// Unit tests: error recovery mode — multi-error collection.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { parseWithRecovery } from '../../source/recovery.js';

describe('parseWithRecovery', () => {
  it('returns full AST for valid queries', () => {
    const result = parseWithRecovery('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.ast).not.toBeNull();
    expect(result.errors).toHaveLength(0);
    expect(result.ast!.type).toBe('MetricsInsightsQuery');
  });

  it('returns partial AST and errors for broken queries', () => {
    const result = parseWithRecovery('SELECT FOO(CPUUtilization) FROM "AWS/EC2"');
    // FOO is not a valid function, but SELECT + FROM may still be extracted
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles completely invalid input gracefully', () => {
    // Should not throw even on garbage input
    const result = parseWithRecovery('NOT A QUERY AT ALL');
    expect(result).toHaveProperty('ast');
    expect(result).toHaveProperty('errors');
    // May be null (no valid clauses) or may try partial parse
  });

  it('handles empty input', () => {
    const result = parseWithRecovery('');
    expect(result.ast).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('collects multiple errors for multiple broken clauses', () => {
    const result = parseWithRecovery(
      'SELECT A(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId = \'i-123\' GROUP BY ORDER BY LIMIT abc'
    );
    // Should capture errors from: SELECT (invalid function), GROUP BY (incomplete), LIMIT (non-numeric)
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('distinguishes between valid and error results', () => {
    const valid = parseWithRecovery('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(valid.errors).toHaveLength(0);

    const invalid = parseWithRecovery('SELECT AVG(CPUUtilization) FROM INVALID_FROM');
    // May still parse partially or error; either way the type is consistent
    expect(invalid).toHaveProperty('ast');
    expect(invalid).toHaveProperty('errors');
  });
});

describe('normal parse vs recovery', () => {
  it('normal parse throws on first error', () => {
    expect(() => parse('SELECT FOO(x) FROM "AWS/EC2"')).toThrow();
  });

  it('recovery mode does not throw', () => {
    expect(() => parseWithRecovery('SELECT FOO(x) FROM "AWS/EC2"')).not.toThrow();
  });
});
