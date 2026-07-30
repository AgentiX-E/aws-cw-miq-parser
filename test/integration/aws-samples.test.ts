// Integration tests: parse all 48 AWS official CloudWatch Metrics Insights sample queries.
// Each query must parse correctly and produce a structurally valid ParsedQuery AST.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../../source/parser.js';
import type { ParsedQuery } from '../../source/types.js';

const fixturesDir = join(__dirname, '..', 'fixtures', 'valid', 'aws-official');

// Load all .miq fixture files
const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.miq'))
  .sort();

describe('AWS Official Sample Queries', () => {
  // Every single AWS sample query must parse without error
  describe.each(fixtureFiles)('%s', (filename) => {
    const query = readFileSync(join(fixturesDir, filename), 'utf-8').trim();

    it('parses successfully', () => {
      const result = parse(query);
      expect(result).toBeDefined();
      expect(result.type).toBe('MetricsInsightsQuery');
    });

    it('has valid SELECT clause', () => {
      const result = parse(query);
      expect(result.select.type).toBe('SelectClause');
      expect(result.select.function).toMatch(/^(AVG|COUNT|MAX|MIN|SUM)$/);
      expect(result.select.metricName).toBeTruthy();
      expect(result.select.metricName.length).toBeGreaterThan(0);
    });

    it('has valid FROM clause', () => {
      const result = parse(query);
      expect(['NamespaceFrom', 'SchemaFrom']).toContain(result.from.type);
      if (result.from.type === 'NamespaceFrom') {
        expect(result.from.namespace).toBeTruthy();
      } else {
        expect(result.from.namespace).toBeTruthy();
        expect(Array.isArray(result.from.dimensions)).toBe(true);
      }
    });

    it('has source locations on root', () => {
      const result = parse(query);
      expect(result.location).toBeDefined();
      expect(result.location.start).toBeDefined();
      expect(result.location.end).toBeDefined();
      expect(result.location.start.line).toBeGreaterThanOrEqual(1);
      expect(result.location.start.column).toBeGreaterThanOrEqual(1);
    });

    it('has source locations on SELECT clause', () => {
      const result = parse(query);
      expect(result.select.location).toBeDefined();
      expect(result.select.location.start.line).toBeGreaterThanOrEqual(1);
    });

    it('has source locations on FROM clause', () => {
      const result = parse(query);
      expect(result.from.location).toBeDefined();
    });

    it('parse is deterministic', () => {
      const first = parse(query);
      const second = parse(query);
      expect(second).toEqual(first);
    });
  });

  // Validate specific query structures
  describe('structural validation', () => {
    it('query 01: bare namespace FROM', () => {
      const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
      expect(q.select.function).toBe('AVG');
      expect(q.select.metricName).toBe('CPUUtilization');
      expect(q.from.type).toBe('NamespaceFrom');
      expect(q.from.namespace).toBe('AWS/EC2');
    });

    it('query 03: SCHEMA with one dimension', () => {
      const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
      expect(q.from.type).toBe('SchemaFrom');
      expect(q.from.namespace).toBe('AWS/EC2');
      if (q.from.type === 'SchemaFrom') {
        expect(q.from.dimensions).toEqual(['InstanceId']);
      }
    });

    it('query 04: SCHEMA with two dimensions', () => {
      const q = parse('SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer, AvailabilityZone)');
      expect(q.from.type).toBe('SchemaFrom');
      if (q.from.type === 'SchemaFrom') {
        expect(q.from.dimensions).toEqual(['LoadBalancer', 'AvailabilityZone']);
      }
    });

    it('query 05: full query with WHERE, GROUP BY, ORDER BY, LIMIT', () => {
      const q = parse(
        'SELECT COUNT(CallCount) FROM SCHEMA("AWS/Usage", Class, Resource, Service, Type) WHERE Type = \'API\' GROUP BY Service, Resource ORDER BY COUNT() DESC LIMIT 20'
      );
      expect(q.where).toBeDefined();
      expect(q.where!.conditions).toHaveLength(1);
      expect(q.where!.conditions[0]!.logicalOperator).toBeNull();
      expect(q.groupBy).toBeDefined();
      expect(q.groupBy!.items).toHaveLength(2);
      expect(q.orderBy).toBeDefined();
      expect(q.orderBy!.function).toBe('COUNT');
      expect(q.orderBy!.direction).toBe('DESC');
      expect(q.limit).toBeDefined();
      expect(q.limit!.value).toBe(20);
    });

    it('query 08: WHERE with string value', () => {
      const q = parse(
        "SELECT MAX(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-1234567890abcdef0'"
      );
      expect(q.where!.conditions[0]!.labelKey).toBe('InstanceId');
      expect(q.where!.conditions[0]!.operator).toBe('=');
      expect(q.where!.conditions[0]!.labelValue).toBe('i-1234567890abcdef0');
      expect(q.where!.conditions[0]!.isTag).toBe(false);
    });

    it('query 09: WHERE with tag', () => {
      const q = parse("SELECT MAX(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod'");
      expect(q.where!.conditions[0]!.labelKey).toBe('tag.env');
      expect(q.where!.conditions[0]!.isTag).toBe(true);
    });

    it('query 10: GROUP BY with quoted tag', () => {
      const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag."aws:cloudformation:stack-name"');
      expect(q.groupBy!.items[0]!.labelKey).toBe('tag.aws:cloudformation:stack-name');
      expect(q.groupBy!.items[0]!.isTag).toBe(true);
    });

    it('query 19: bare namespace with WHERE', () => {
      const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/CWAgent\" WHERE ApplicationName = 'eCommerce'");
      expect(q.from.type).toBe('NamespaceFrom');
      expect(q.from.namespace).toBe('AWS/CWAgent');
      expect(q.where!.conditions[0]!.labelKey).toBe('ApplicationName');
    });

    it('query 32: quoted metric name with dots', () => {
      const q = parse('SELECT SUM("PutRecords.Bytes") FROM SCHEMA("AWS/Kinesis", StreamName) GROUP BY StreamName ORDER BY SUM() DESC LIMIT 10');
      expect(q.select.metricName).toBe('PutRecords.Bytes');
    });

    it('query 34: no LIMIT clause', () => {
      const q = parse('SELECT SUM(Invocations) FROM SCHEMA("AWS/Lambda", FunctionName) GROUP BY FunctionName ORDER BY SUM() DESC');
      expect(q.limit).toBeUndefined();
    });

    it('query 43: minimal query — no optional clauses', () => {
      const q = parse('SELECT SUM(NumberOfMessagesPublished) FROM SCHEMA("AWS/SNS", TopicName)');
      expect(q.where).toBeUndefined();
      expect(q.groupBy).toBeUndefined();
      expect(q.orderBy).toBeUndefined();
      expect(q.limit).toBeUndefined();
    });

    it('all aggregation functions are recognized', () => {
      const functions = ['AVG', 'COUNT', 'MAX', 'MIN', 'SUM'] as const;
      for (const fn of functions) {
        const q = parse(`SELECT ${fn}(CPUUtilization) FROM "AWS/EC2"`);
        expect(q.select.function).toBe(fn);
      }
    });

    it('ASC and DESC both parse correctly', () => {
      const ascResult = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() ASC');
      expect(ascResult.orderBy!.direction).toBe('ASC');

      const descResult = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() DESC');
      expect(descResult.orderBy!.direction).toBe('DESC');

      // Default is ASC when direction is omitted
      const defaultResult = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG()');
      expect(defaultResult.orderBy!.direction).toBe('ASC');
    });
  });
});

describe('Parse error handling', () => {
  it('throws on empty string', () => {
    expect(() => parse('')).toThrow();
    expect(() => parse('   ')).toThrow();
  });

  it('throws on missing FROM clause', () => {
    expect(() => parse('SELECT AVG(CPUUtilization)')).toThrow();
  });

  it('throws on invalid function', () => {
    expect(() => parse('SELECT FOO(CPUUtilization) FROM "AWS/EC2"')).toThrow();
  });

  it('throws on incomplete query', () => {
    expect(() => parse('SELECT AVG(CPUUtilization) FROM')).toThrow();
  });
});
