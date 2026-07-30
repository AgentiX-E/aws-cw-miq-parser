// Unit tests: WHERE, GROUP BY, ORDER BY, LIMIT clauses, comments, edge cases.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';

describe('WHERE clause', () => {
  it('parses single condition with =', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceType = 't2.micro'");
    expect(result.where!.conditions).toHaveLength(1);
    expect(result.where!.conditions[0]!.labelKey).toBe('InstanceType');
    expect(result.where!.conditions[0]!.operator).toBe('=');
    expect(result.where!.conditions[0]!.labelValue).toBe('t2.micro');
    expect(result.where!.conditions[0]!.isTag).toBe(false);
    expect(result.where!.conditions[0]!.logicalOperator).toBeNull();
  });

  it('parses single condition with !=', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceType != 't2.micro'");
    expect(result.where!.conditions[0]!.operator).toBe('!=');
  });

  it.each(['<', '<=', '>', '>='] as const)('parses operator %s', (op) => {
    const result = parse(`SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceType ${op} 't2.micro'`);
    expect(result.where!.conditions[0]!.operator).toBe(op);
  });

  it('parses multiple AND conditions', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceType = 't2.micro' AND InstanceId = 'i-123'");
    expect(result.where!.conditions).toHaveLength(2);
    expect(result.where!.conditions[0]!.logicalOperator).toBeNull();
    expect(result.where!.conditions[1]!.logicalOperator).toBe('AND');
    expect(result.where!.conditions[1]!.labelKey).toBe('InstanceId');
  });

  it('parses three AND conditions', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' AND c = '3'");
    expect(result.where!.conditions).toHaveLength(3);
    expect(result.where!.conditions[2]!.logicalOperator).toBe('AND');
  });

  it('parses tag condition', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod'");
    expect(result.where!.conditions[0]!.labelKey).toBe('tag.env');
    expect(result.where!.conditions[0]!.isTag).toBe(true);
  });

  it('parses mixed tag and dimension conditions', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE tag.env = 'prod' AND InstanceType = 'm5.large'");
    expect(result.where!.conditions).toHaveLength(2);
    expect(result.where!.conditions[0]!.isTag).toBe(true);
    expect(result.where!.conditions[1]!.isTag).toBe(false);
  });

  it('parses number value comparison', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE Count = 100");
    expect(result.where!.conditions[0]!.labelValue).toBe(100);
  });

  it('parses single-quoted value with apostrophe', () => {
    const result = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE Name = 'it\\'s'");
    expect(result.where!.conditions[0]!.labelValue).toBe("it's");
  });

  it('rejects incomplete WHERE', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE')).toThrow();
  });

  it('rejects WHERE with missing operator', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceType')).toThrow();
  });

  it('rejects WHERE with missing value', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceType =')).toThrow();
  });
});

describe('GROUP BY clause', () => {
  it('parses single GROUP BY key', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId');
    expect(result.groupBy!.items).toHaveLength(1);
    expect(result.groupBy!.items[0]!.labelKey).toBe('InstanceId');
  });

  it('parses multiple GROUP BY keys', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId, InstanceType');
    expect(result.groupBy!.items).toHaveLength(2);
    expect(result.groupBy!.items[1]!.labelKey).toBe('InstanceType');
  });

  it('parses tag GROUP BY', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag.env');
    expect(result.groupBy!.items[0]!.isTag).toBe(true);
    expect(result.groupBy!.items[0]!.labelKey).toBe('tag.env');
  });

  it('parses quoted tag GROUP BY', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag."aws:cloudformation:stack-name"');
    expect(result.groupBy!.items[0]!.isTag).toBe(true);
    expect(result.groupBy!.items[0]!.labelKey).toBe('tag.aws:cloudformation:stack-name');
  });

  it('parses mixed tag and regular GROUP BY', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag.team, InstanceType');
    expect(result.groupBy!.items[0]!.isTag).toBe(true);
    expect(result.groupBy!.items[1]!.isTag).toBe(false);
  });

  it('rejects GROUP BY with missing keys', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY')).toThrow();
  });
});

describe('ORDER BY clause', () => {
  it('parses ORDER BY with DESC', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() DESC');
    expect(result.orderBy!.function).toBe('AVG');
    expect(result.orderBy!.direction).toBe('DESC');
  });

  it('parses ORDER BY with ASC', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY SUM() ASC');
    expect(result.orderBy!.function).toBe('SUM');
    expect(result.orderBy!.direction).toBe('ASC');
  });

  it('defaults to ASC when direction omitted', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY MAX()');
    expect(result.orderBy!.direction).toBe('ASC');
  });

  it('accepts all functions in ORDER BY', () => {
    for (const fn of ['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']) {
      const result = parse(`SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY ${fn}()`);
      expect(result.orderBy!.function).toBe(fn);
    }
  });

  it('rejects invalid function in ORDER BY', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY FOO()')).toThrow();
  });

  it('rejects invalid direction', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() INVALID')).toThrow();
  });
});

describe('LIMIT clause', () => {
  it('parses LIMIT 1', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 1');
    expect(result.limit!.value).toBe(1);
  });

  it('parses LIMIT 500', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 500');
    expect(result.limit!.value).toBe(500);
  });

  it('parses LIMIT 10', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10');
    expect(result.limit!.value).toBe(10);
  });

  it('rejects LIMIT with non-numeric value', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT abc')).toThrow();
  });

  it('rejects LIMIT with negative number', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT -1')).toThrow();
  });
});

describe('Comments', () => {
  it('parses line comment at end', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" -- This is a comment');
    expect(result.select.function).toBe('AVG');
  });

  it('parses line comment on separate line before query', () => {
    const result = parse('-- Top metrics\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.select.function).toBe('AVG');
  });

  it('parses block comment', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" /* inline comment */');
    expect(result.select.function).toBe('AVG');
  });

  it('parses multi-line block comment', () => {
    const result = parse('/*\n  Multi-line\n  comment\n*/\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.select.function).toBe('AVG');
  });
});

describe('Edge cases', () => {
  it('parses keyword-lowercased query', () => {
    const result = parse('select avg(CPUUtilization) from "AWS/EC2"');
    expect(result.select.function).toBe('AVG');
    expect(result.from.namespace).toBe('AWS/EC2');
  });

  it('parses mixed case keywords', () => {
    const result = parse('SeLeCt AvG(CPUUtilization) FrOm "AWS/EC2"');
    expect(result.select.function).toBe('AVG');
  });

  it('parses all five functions', () => {
    for (const fn of ['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']) {
      const result = parse(`SELECT ${fn}(CPUUtilization) FROM "AWS/EC2"`);
      expect(result.select.function).toBe(fn);
    }
  });

  it('parses minimal query (only SELECT + FROM)', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.select).toBeDefined();
    expect(result.from).toBeDefined();
    expect(result.where).toBeUndefined();
    expect(result.groupBy).toBeUndefined();
    expect(result.orderBy).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });
});

describe('Negative tests — syntax errors', () => {
  it('empty string throws', () => {
    expect(() => parse('')).toThrow();
  });

  it('whitespace-only throws', () => {
    expect(() => parse('   \n\t  ')).toThrow();
  });

  it('missing SELECT throws', () => {
    expect(() => parse('FROM "AWS/EC2"')).toThrow();
  });

  it('missing FROM throws', () => {
    expect(() => parse('SELECT AVG(CPUUtilization)')).toThrow();
  });

  it('wrong clause order GROUP BY before WHERE throws', () => {
    // AWS spec requires WHERE before GROUP BY
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId WHERE InstanceType = \'t2.micro\'')).toThrow();
  });

  it('wrong clause order LIMIT before ORDER BY throws', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10 ORDER BY AVG()')).toThrow();
  });

  it('extra token at end throws', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10 EXTRA')).toThrow();
  });
});
