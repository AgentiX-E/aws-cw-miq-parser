// Unit tests: Zod runtime schema validation of ParsedQuery AST.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { validateAst, safeValidateAst, parsedQuerySchema } from '../../source/schema.js';

describe('validateAst', () => {
  it('validates a real parsed query output', () => {
    const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const result = validateAst(ast);
    expect(result.type).toBe('MetricsInsightsQuery');
    expect(result.select.function).toBe('AVG');
  });

  it('validates a full query with all optional clauses', () => {
    const ast = parse(
      'SELECT COUNT(CallCount) FROM SCHEMA("AWS/Usage", Class, Resource, Service, Type) WHERE Type = \'API\' GROUP BY Service, Resource ORDER BY COUNT() DESC LIMIT 20'
    );
    const result = validateAst(ast);
    expect(result.where).toBeDefined();
    expect(result.groupBy).toBeDefined();
    expect(result.orderBy).toBeDefined();
    expect(result.limit).toBeDefined();
  });

  it('throws on invalid data', () => {
    expect(() => validateAst(null)).toThrow();
    expect(() => validateAst(undefined)).toThrow();
    expect(() => validateAst({})).toThrow();
    expect(() => validateAst({ type: 'WrongType' })).toThrow();
  });

  it('throws on missing required fields', () => {
    expect(() => validateAst({ type: 'MetricsInsightsQuery' })).toThrow();
  });

  it('throws on invalid function name', () => {
    const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const mutated = { ...ast, select: { ...ast.select, function: 'INVALID' } };
    expect(() => validateAst(mutated)).toThrow();
  });

  it('throws on invalid LIMIT', () => {
    const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10');
    const mutated = { ...ast, limit: { ...ast.limit!, value: 0 } };
    expect(() => validateAst(mutated)).toThrow();
  });
});

describe('safeValidateAst', () => {
  it('returns success for valid data', () => {
    const ast = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const result = safeValidateAst(ast);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.select.metricName).toBe('CPUUtilization');
    }
  });

  it('returns error object on failure', () => {
    const result = safeValidateAst({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('parsedQuerySchema', () => {
  it('has expected shape', () => {
    const shape = parsedQuerySchema.shape;
    expect(shape.type).toBeDefined();
    expect(shape.select).toBeDefined();
    expect(shape.from).toBeDefined();
    expect(shape.location).toBeDefined();
  });
});
