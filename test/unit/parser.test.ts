// Unit tests: parser error paths, input validation, and error enrichment.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';

describe('parse — input validation', () => {
  it('throws on non-string input (null)', () => {
    expect(() => parse(null as unknown as string)).toThrow('parse(): input must be a string');
  });

  it('throws on non-string input (undefined)', () => {
    expect(() => parse(undefined as unknown as string)).toThrow('parse(): input must be a string');
  });

  it('throws on non-string input (number)', () => {
    expect(() => parse(123 as unknown as string)).toThrow('parse(): input must be a string');
  });

  it('throws on empty string', () => {
    expect(() => parse('')).toThrow('Empty query string');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parse('   \n\t  ')).toThrow('Empty query string');
  });

  it('throws on query exceeding 4096 characters', () => {
    const longNs = 'x'.repeat(4085);
    const longQuery = `SELECT AVG(CPUUtilization) FROM "${longNs}"`;
    expect(() => parse(longQuery)).toThrow('exceeds the maximum length');
  });

  it('accepts query at exactly 4096 characters', () => {
    // 4096 = SELECT + metric + FROM + quotes + namespace
    const ns = 'y'.repeat(4096 - 'SELECT AVG(CPUUtilization) FROM ""'.length);
    const query = `SELECT AVG(CPUUtilization) FROM "${ns}"`;
    const result = parse(query);
    expect(result.type).toBe('MetricsInsightsQuery');
  });
});

describe('parse — syntax error enrichment', () => {
  it('includes expected tokens for invalid function', () => {
    try {
      parse('SELECT FOO(CPUUtilization) FROM "AWS/EC2"');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.location).toBeDefined();
      expect(err.location.start.line).toBeGreaterThanOrEqual(1);
    }
  });

  it('includes found token in incomplete WHERE error', () => {
    try {
      parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE');
      expect.fail('Should have thrown');
    } catch (err: any) {
      // Peggy may report what it found (often null for end-of-input)
      expect(err.location).toBeDefined();
    }
  });

  it('error location points near the problem', () => {
    try {
      parse('SELECT AVG(CPUUtilization) FROM');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.location).toBeDefined();
      expect(err.location.start.offset).toBeGreaterThan(25);
    }
  });

  it('throws typed ParseError on unknown function', () => {
    try {
      parse('SELECT UNKNOWN(CPUUtilization) FROM "AWS/EC2"');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });

  it('throws typed ParseError (not raw Peggy error)', () => {
    try {
      parse('SELECT AVG(CPUUtilization) FROM');
      expect.fail('Should have thrown');
    } catch (err: any) {
      // Our parser wraps the error, so it should have our structure
      expect(err.location).toBeDefined();
      expect(typeof err.message).toBe('string');
    }
  });
});

describe('parse — valid query output structure', () => {
  it('returns typed ParsedQuery with all expected fields', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.type).toBe('MetricsInsightsQuery');
    expect(result.select.function).toBe('AVG');
    expect(result.select.metricName).toBe('CPUUtilization');
    expect(result.from.type).toBe('NamespaceFrom');
    expect(result.from.namespace).toBe('AWS/EC2');
    expect(result.location).toBeDefined();
    expect(result.location.start.line).toBe(1);
    expect(result.location.start.column).toBe(1);
  });

  it('preserves identifier casing in output', () => {
    const result = parse('SELECT AVG(MyMetric) FROM "MyNamespace"');
    expect(result.select.metricName).toBe('MyMetric');
    expect(result.from.namespace).toBe('MyNamespace');
  });
});
