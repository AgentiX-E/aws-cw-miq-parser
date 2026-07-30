// Unit tests: FROM clause parsing — both NAMESPACE and SCHEMA variants.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';

const baseQuery = (from: string) => `SELECT AVG(CPUUtilization) ${from}`;

describe('FROM clause — NAMESPACE variant', () => {
  it('parses bare namespace with double quotes', () => {
    const result = parse(baseQuery('FROM "AWS/EC2"'));
    expect(result.from.type).toBe('NamespaceFrom');
    expect(result.from.namespace).toBe('AWS/EC2');
  });

  it('parses namespace without quotes', () => {
    const result = parse(baseQuery('FROM AWS_EC2'));
    expect(result.from.type).toBe('NamespaceFrom');
    expect(result.from.namespace).toBe('AWS_EC2');
  });

  it('parses namespace with slash requires quotes', () => {
    // Namespaces with / must be quoted per AWS spec
    expect(() => parse(baseQuery('FROM AWS/EC2'))).toThrow();
  });

  it('parses custom namespace', () => {
    const result = parse(baseQuery('FROM "Custom/App"'));
    expect(result.from.namespace).toBe('Custom/App');
  });

  it('parses ContainerInsights namespace', () => {
    const result = parse(baseQuery('FROM "ContainerInsights"'));
    expect(result.from.namespace).toBe('ContainerInsights');
  });
});

describe('FROM clause — SCHEMA variant', () => {
  it('parses SCHEMA with zero dimensions', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/EC2")'));
    expect(result.from.type).toBe('SchemaFrom');
    expect(result.from.namespace).toBe('AWS/EC2');
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual([]);
    }
  });

  it('parses SCHEMA with one dimension', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/EC2", InstanceId)'));
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual(['InstanceId']);
    }
  });

  it('parses SCHEMA with two dimensions', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/EC2", InstanceId, InstanceType)'));
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual(['InstanceId', 'InstanceType']);
    }
  });

  it('parses SCHEMA with three dimensions', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/Usage", Class, Resource, Service)'));
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual(['Class', 'Resource', 'Service']);
    }
  });

  it('parses SCHEMA with quoted dimension names', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/EC2", "InstanceId", "InstanceType")'));
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual(['InstanceId', 'InstanceType']);
    }
  });

  it('parses SCHEMA with mixed quoted/unquoted dimensions', () => {
    const result = parse(baseQuery('FROM SCHEMA("AWS/EC2", "InstanceId", InstanceType)'));
    if (result.from.type === 'SchemaFrom') {
      expect(result.from.dimensions).toEqual(['InstanceId', 'InstanceType']);
    }
  });

  it('parses SCHEMA with unquoted namespace (semantic validation deferred to validator)', () => {
    // InstanceId is syntactically valid as a namespace — semantic validator will flag
    // that it should be a namespace like "AWS/EC2" in M2
    const result = parse(baseQuery('FROM SCHEMA(InstanceId)'));
    expect(result.from.type).toBe('SchemaFrom');
    expect(result.from.namespace).toBe('InstanceId');
  });
});

describe('FROM clause — whitespace handling', () => {
  it('handles extra spaces', () => {
    const result = parse(`SELECT   AVG(CPUUtilization)   FROM    "AWS/EC2"`);
    expect(result.from.namespace).toBe('AWS/EC2');
  });

  it('handles newlines', () => {
    const result = parse(`SELECT AVG(CPUUtilization)\nFROM "AWS/EC2"`);
    expect(result.from.namespace).toBe('AWS/EC2');
  });

  it('handles tabs', () => {
    const result = parse(`SELECT AVG(CPUUtilization)\tFROM "AWS/EC2"`);
    expect(result.from.namespace).toBe('AWS/EC2');
  });
});
