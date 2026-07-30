// Unit tests: WHERE OR and CURRENT_ACCOUNT_ID advanced features (M3).

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { serialize } from '../../source/serializer.js';

describe('WHERE OR support', () => {
  it('parses OR between two conditions', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' OR b = '2'");
    expect(q.where!.conditions).toHaveLength(2);
    expect(q.where!.conditions[0]!.logicalOperator).toBeNull();
    expect(q.where!.conditions[1]!.logicalOperator).toBe('OR');
  });

  it('parses mixed AND and OR', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' OR c = '3'");
    expect(q.where!.conditions).toHaveLength(3);
    expect(q.where!.conditions[0]!.logicalOperator).toBeNull();
    expect(q.where!.conditions[1]!.logicalOperator).toBe('AND');
    expect(q.where!.conditions[2]!.logicalOperator).toBe('OR');
  });

  it('serializer preserves OR in output', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' OR b = '2'");
    const result = serialize(q);
    expect(result).toContain('OR');
  });
});

describe('CURRENT_ACCOUNT_ID', () => {
  it('parses CURRENT_ACCOUNT_ID() as label value', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE AWS.AccountId = CURRENT_ACCOUNT_ID()");
    expect(q.where!.conditions[0]!.labelValue).toBe('CURRENT_ACCOUNT_ID()');
    expect(q.where!.conditions[0]!.labelKey).toBe('AWS.AccountId');
  });

  it('parses AWS.AccountId with numeric account id', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE AWS.AccountId = '123456789012'");
    expect(q.where!.conditions[0]!.labelKey).toBe('AWS.AccountId');
    expect(q.where!.conditions[0]!.labelValue).toBe('123456789012');
  });

  it('serializer preserves CURRENT_ACCOUNT_ID()', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE AWS.AccountId = CURRENT_ACCOUNT_ID()");
    const result = serialize(q);
    expect(result).toContain('CURRENT_ACCOUNT_ID()');
  });
});
