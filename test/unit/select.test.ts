// Unit tests: SELECT clause parsing — function recognition, metric name extraction.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';

describe('SELECT clause', () => {
  const baseQuery = (select: string) => `${select} FROM "AWS/EC2"`;

  it.each([
    { fn: 'AVG', expected: 'AVG' },
    { fn: 'avg', expected: 'AVG' },
    { fn: 'Count', expected: 'COUNT' },
    { fn: 'MAX', expected: 'MAX' },
    { fn: 'min', expected: 'MIN' },
    { fn: 'Sum', expected: 'SUM' },
  ])('normalizes $fn to $expected', ({ fn, expected }) => {
    const result = parse(baseQuery(`SELECT ${fn}(CPUUtilization)`));
    expect(result.select.function).toBe(expected);
  });

  it('extracts simple metric name', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.select.metricName).toBe('CPUUtilization');
  });

  it('extracts metric name with underscores', () => {
    const result = parse('SELECT AVG(node_cpu_utilization) FROM "AWS/EC2"');
    expect(result.select.metricName).toBe('node_cpu_utilization');
  });

  it('extracts quoted metric name with dots', () => {
    const result = parse('SELECT SUM("PutRecords.Bytes") FROM "AWS/Kinesis"');
    expect(result.select.metricName).toBe('PutRecords.Bytes');
  });

  it('extracts quoted metric name with spaces', () => {
    const result = parse('SELECT AVG("My Custom Metric") FROM "Custom/NS"');
    expect(result.select.metricName).toBe('My Custom Metric');
  });

  it('rejects invalid function FOO', () => {
    expect(() => parse('SELECT FOO(CPUUtilization) FROM "AWS/EC2"')).toThrow();
  });

  it('rejects missing metric name', () => {
    expect(() => parse('SELECT AVG() FROM "AWS/EC2"')).toThrow();
  });

  it('rejects missing parentheses', () => {
    expect(() => parse('SELECT AVG CPUUtilization FROM "AWS/EC2"')).toThrow();
  });

  it('has correct source location', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.select.location.start.column).toBe(1);
  });
});
