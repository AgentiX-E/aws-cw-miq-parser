// Unit tests: serializer — ParsedQuery → string round-trip fidelity.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { serialize, quoteIdentifier } from '../../source/serializer.js';

describe('serialize — basic round-trip', () => {
  it('SELECT + FROM namespace round-trips', () => {
    const input = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const result = serialize(parse(input));
    const reparsed = parse(result);
    // Semantic equivalence check
    expect(reparsed.select.function).toBe('AVG');
    expect(reparsed.select.metricName).toBe('CPUUtilization');
    expect(reparsed.from.type).toBe('NamespaceFrom');
    expect(reparsed.from.namespace).toBe('AWS/EC2');
  });

  it('full query round-trips', () => {
    const input = 'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer) WHERE LoadBalancer = \'app/lb-1\' GROUP BY LoadBalancer ORDER BY MAX() DESC LIMIT 5';
    const result = serialize(parse(input));
    const reparsed = parse(result);

    expect(reparsed.select.function).toBe('SUM');
    expect(reparsed.from.type).toBe('SchemaFrom');
    expect(reparsed.where).toBeDefined();
    expect(reparsed.groupBy).toBeDefined();
    expect(reparsed.orderBy!.direction).toBe('DESC');
    expect(reparsed.limit!.value).toBe(5);
  });
});

describe('serialize — keyword casing', () => {
  it('uppercases keywords by default', () => {
    const input = 'select avg(CPUUtilization) from "AWS/EC2"';
    const result = serialize(parse(input));
    expect(result).toContain('SELECT');
    expect(result).toContain('AVG');
    expect(result).toContain('FROM');
  });

  it('lowercases when uppercase:false', () => {
    const input = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const result = serialize(parse(input), { uppercase: false });
    expect(result).toContain('select');
    expect(result).toContain('from');
  });
});

describe('serialize — pretty printing', () => {
  it('flat by default', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId = \'i-123\'');
    const result = serialize(q);
    expect(result.split('\n').length).toBe(1);
  });

  it('multi-line when pretty:true', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) WHERE InstanceId = \'i-123\'');
    const result = serialize(q, { pretty: true });
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

describe('serialize — clause reconstruction', () => {
  it('reconstructs WHERE with AND chain', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' AND c = '3'");
    const result = serialize(q);
    expect(result).toContain('AND');
    expect(result).toContain("a = '1'");
    expect(result).toContain("b = '2'");
    expect(result).toContain("c = '3'");
  });

  it('reconstructs tag condition', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod'");
    const result = serialize(q);
    expect(result).toContain('tag.env');
  });

  it('reconstructs GROUP BY with multiple keys', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId, InstanceType');
    const result = serialize(q);
    expect(result).toContain('GROUP BY');
    expect(result).toContain('InstanceId');
    expect(result).toContain('InstanceType');
  });

  it('reconstructs ORDER BY with direction', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY MAX() DESC');
    const result = serialize(q);
    expect(result).toContain('ORDER BY');
    expect(result).toContain('MAX()');
    expect(result).toContain('DESC');
  });

  it('omits ASC direction (default)', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() ASC');
    const result = serialize(q);
    expect(result).not.toContain('ASC');
  });

  it('reconstructs LIMIT', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 50');
    const result = serialize(q);
    expect(result).toContain('LIMIT 50');
  });
});

describe('serialize — round-trip property', () => {
  const queries = [
    'SELECT AVG(CPUUtilization) FROM "AWS/EC2"',
    'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2")',
    'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)',
    'SELECT COUNT(CallCount) FROM SCHEMA("AWS/Usage", Class, Resource, Service, Type) WHERE Type = \'API\' GROUP BY Service, Resource ORDER BY COUNT() DESC LIMIT 20',
    'SELECT MAX(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId = \'i-1234567890abcdef0\'',
    'SELECT SUM("PutRecords.Bytes") FROM SCHEMA("AWS/Kinesis", StreamName) GROUP BY StreamName ORDER BY SUM() DESC LIMIT 10',
    'SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag."aws:cloudformation:stack-name"',
    "SELECT AVG(CPUUtilization) FROM \"AWS/CWAgent\" WHERE ApplicationName = 'eCommerce'",
  ];

  it.each(queries)('parse(serialize(parse(%s))) ≡ parse(%s)', (input) => {
    const first = parse(input);
    const serialized = serialize(first);
    const second = parse(serialized);

    // Structural equivalence
    expect(second.type).toBe(first.type);
    expect(second.select.function).toBe(first.select.function);
    expect(second.select.metricName).toBe(first.select.metricName);
    expect(second.from.type).toBe(first.from.type);
    expect(second.from.namespace).toBe(first.from.namespace);

    if (first.where) {
      expect(second.where).toBeDefined();
      expect(second.where!.conditions.length).toBe(first.where.conditions.length);
      for (let i = 0; i < first.where.conditions.length; i++) {
        expect(second.where!.conditions[i]!.labelKey).toBe(first.where.conditions[i]!.labelKey);
        expect(second.where!.conditions[i]!.operator).toBe(first.where.conditions[i]!.operator);
        expect(second.where!.conditions[i]!.labelValue).toBe(first.where.conditions[i]!.labelValue);
      }
    }

    if (first.groupBy) {
      expect(second.groupBy).toBeDefined();
      expect(second.groupBy!.items.map((i) => i.labelKey))
        .toEqual(first.groupBy.items.map((i) => i.labelKey));
    }

    if (first.orderBy) {
      expect(second.orderBy).toBeDefined();
      expect(second.orderBy!.function).toBe(first.orderBy.function);
      expect(second.orderBy!.direction).toBe(first.orderBy.direction);
    }

    if (first.limit) {
      expect(second.limit).toBeDefined();
      expect(second.limit!.value).toBe(first.limit.value);
    }
  });
});

describe('quoteIdentifier', () => {
  it('quotes identifiers with slashes', () => {
    expect(quoteIdentifier('AWS/EC2')).toBe('"AWS/EC2"');
  });

  it('quotes identifiers with dots', () => {
    expect(quoteIdentifier('PutRecords.Bytes')).toBe('"PutRecords.Bytes"');
  });

  it('does not quote simple identifiers', () => {
    expect(quoteIdentifier('CPUUtilization')).toBe('CPUUtilization');
    expect(quoteIdentifier('InstanceId')).toBe('InstanceId');
  });

  it('handles leading underscore', () => {
    expect(quoteIdentifier('_private')).toBe('_private');
  });
});
