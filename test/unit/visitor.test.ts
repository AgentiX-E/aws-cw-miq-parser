// Unit tests: AST Visitor — traversal API for downstream consumers.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { traverse } from '../../source/visitor.js';
import type { QueryVisitor } from '../../source/visitor.js';

describe('traverse', () => {
  it('visits all nodes in a full query', () => {
    const q = parse(
      'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer) WHERE LoadBalancer = \'app/lb-1\' GROUP BY LoadBalancer ORDER BY MAX() DESC LIMIT 5'
    );

    const visited: string[] = [];
    const visitor: QueryVisitor = {
      visitQuery: () => visited.push('query'),
      visitSelectClause: () => visited.push('select'),
      visitFromClause: () => visited.push('from'),
      visitSchemaFrom: () => visited.push('schema'),
      visitWhereClause: () => visited.push('where'),
      visitWhereCondition: () => visited.push('where-cond'),
      visitGroupByClause: () => visited.push('groupBy'),
      visitGroupByItem: () => visited.push('groupBy-item'),
      visitOrderByClause: () => visited.push('orderBy'),
      visitLimitClause: () => visited.push('limit'),
    };

    traverse(q, visitor);

    expect(visited).toContain('query');
    expect(visited).toContain('select');
    expect(visited).toContain('from');
    expect(visited).toContain('schema');
    expect(visited).toContain('where');
    expect(visited).toContain('where-cond');
    expect(visited).toContain('groupBy');
    expect(visited).toContain('groupBy-item');
    expect(visited).toContain('orderBy');
    expect(visited).toContain('limit');
  });

  it('collects namespace from simple query', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const namespaces: string[] = [];

    traverse(q, {
      visitNamespaceFrom(node) {
        namespaces.push(node.namespace);
      },
    });

    expect(namespaces).toEqual(['AWS/EC2']);
  });

  it('collects all dimensions from SCHEMA', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId, InstanceType)');
    const dimensions: string[] = [];

    traverse(q, {
      visitSchemaFrom(node) {
        dimensions.push(...node.dimensions);
      },
    });

    expect(dimensions).toEqual(['InstanceId', 'InstanceType']);
  });

  it('collects all WHERE conditions', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' AND c = '3'");
    const keys: string[] = [];

    traverse(q, {
      visitWhereCondition(node) {
        keys.push(node.labelKey);
      },
    });

    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('skips unimplemented visitor methods silently', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    // Empty visitor object — should not throw
    expect(() => traverse(q, {})).not.toThrow();
  });

  it('visits optional nodes only when present', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const visited: string[] = [];

    traverse(q, {
      visitWhereClause: () => visited.push('where'),
      visitGroupByClause: () => visited.push('groupBy'),
    });

    expect(visited).not.toContain('where');
    expect(visited).not.toContain('groupBy');
  });
});
