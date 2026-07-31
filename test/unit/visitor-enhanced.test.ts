// Unit tests: enhanced NodePath visitor — mutation, control flow, parent navigation.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { traverseWithPath, NodePath } from '../../source/visitor.js';
import type { LimitClause } from '../../source/types.js';

describe('NodePath', () => {
  it('has node reference', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    traverseWithPath(q, {
      visitQuery(path) {
        expect(path.node.type).toBe('MetricsInsightsQuery');
        expect(path.parent).toBeNull();
      },
    });
  });

  it('has parent reference for child nodes', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    traverseWithPath(q, {
      visitSelectClause(path) {
        expect(path.parent).not.toBeNull();
        expect(path.parent!.node.type).toBe('MetricsInsightsQuery');
      },
    });
  });

  it('parentKey indicates position in parent', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    traverseWithPath(q, {
      visitSelectClause(path) {
        expect(path.parentKey).toBe('select');
      },
      visitFromClause(path) {
        expect(path.parentKey).toBe('from');
      },
    });
  });

  it('type getter returns node type string', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    traverseWithPath(q, {
      visitSelectClause(path) {
        expect(path.type).toBe('SelectClause');
      },
    });
  });
});

describe('NodePath — control flow', () => {
  it('skip prevents child traversal', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10');
    const visited: string[] = [];

    traverseWithPath(q, {
      visitFromClause(path) {
        path.skip();
      },
      visitLimitClause(path) {
        visited.push('limit');
      },
      visitSelectClause(path) {
        visited.push('select');
      },
    });

    // FROM is visited but its children (NamespaceFrom) are skipped
    // However, skip() on FROM doesn't affect sibling LIMIT — only FROM's children
    expect(visited).toContain('select');
    // skip() only affects children of the skipped node, not siblings
  });

  it('stop aborts entire traversal', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10');
    const visited: string[] = [];

    traverseWithPath(q, {
      visitSelectClause(path) {
        visited.push('select');
        path.stop();
      },
      visitFromClause() { visited.push('from'); },
      visitLimitClause() { visited.push('limit'); },
    });

    expect(visited).toEqual(['select']);
  });
});

describe('NodePath — mutation', () => {
  it('replaceWith swaps a node in its parent', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 50');

    traverseWithPath(q, {
      visitLimitClause(path) {
        const newNode: LimitClause = {
          type: 'LimitClause',
          value: 10,
          location: path.node.location,
        };
        path.replaceWith(newNode);
      },
    });

    expect(q.limit!.value).toBe(10);
  });

  it('remove deletes an optional clause', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 50');

    traverseWithPath(q, {
      visitLimitClause(path) {
        path.remove();
      },
    });

    expect(q.limit).toBeUndefined();
  });

  it('remove from array parent', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2'");

    traverseWithPath(q, {
      visitWhereCondition(path) {
        if (path.node.labelKey === 'b') {
          path.remove();
        }
      },
    });

    expect(q.where!.conditions).toHaveLength(1);
    expect(q.where!.conditions[0]!.labelKey).toBe('a');
  });

  it('replaceWith works on array items', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2'");

    traverseWithPath(q, {
      visitWhereCondition(path) {
        if (path.node.labelKey === 'a') {
          path.replaceWith({
            type: 'WhereCondition',
            labelKey: 'replaced',
            operator: '=',
            labelValue: 'newval',
            isTag: false,
            logicalOperator: null,
            location: path.node.location,
          });
        }
      },
    });

    expect(q.where!.conditions[0]!.labelKey).toBe('replaced');
  });

  it('replaceWith no-ops without parent', () => {
    const rootPath = new NodePath(
      parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"')
    );
    // replaceWith on root should be a no-op
    const original = rootPath.node;
    rootPath.replaceWith({ ...original });
    expect(rootPath.node).toBeDefined();
  });

  it('listKey is set for array children', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1'");
    traverseWithPath(q, {
      visitWhereCondition(path) {
        expect(path.listKey).toBe('conditions');
        expect(typeof path.parentKey).toBe('number');
      },
    });
  });

  it('GroupByItem remove works', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY a, b, c');
    traverseWithPath(q, {
      visitGroupByItem(path) {
        if (path.node.labelKey === 'b') {
          path.remove();
        }
      },
    });
    expect(q.groupBy!.items).toHaveLength(2);
    expect(q.groupBy!.items[0]!.labelKey).toBe('a');
    expect(q.groupBy!.items[1]!.labelKey).toBe('c');
  });

  it('stop in WHERE condition breaks the loop', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' AND c = '3'");
    const visited: string[] = [];

    traverseWithPath(q, {
      visitWhereCondition(path) {
        visited.push(path.node.labelKey);
        if (path.node.labelKey === 'b') {
          path.stop();
        }
      },
    });

    // stop should break after 'b', skipping 'c'
    expect(visited).toEqual(['a', 'b']);
  });

  it('stop in GROUP BY item breaks the loop', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY a, b, c');
    const visited: string[] = [];

    traverseWithPath(q, {
      visitGroupByItem(path) {
        visited.push(path.node.labelKey);
        if (path.node.labelKey === 'a') {
          path.stop();
        }
      },
    });

    expect(visited).toEqual(['a']);
  });
});

describe('NodePath.remove', () => {
  it('removes optional clause from parent', () => {
    const query = parse(
      'SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId = \'i-123\' ORDER BY AVG() DESC'
    );
    traverseWithPath(query, {
      visitWhereClause(path) {
        path.remove();
      },
    });

    expect(query.where).toBeUndefined();
    expect(query.orderBy).toBeDefined(); // other clauses unaffected
  });

  it('removes WHERE condition from array', () => {
    const query = parse(
      "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2' AND c = '3'"
    );
    traverseWithPath(query, {
      visitWhereCondition(path, index) {
        if (path.node.labelKey === 'b') {
          path.remove();
        }
      },
    });

    expect(query.where!.conditions).toHaveLength(2);
    expect(query.where!.conditions[0]!.labelKey).toBe('a');
    expect(query.where!.conditions[1]!.labelKey).toBe('c');
  });

  it('removes first WHERE condition from array', () => {
    const query = parse(
      "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' AND b = '2'"
    );
    traverseWithPath(query, {
      visitWhereCondition(path, index) {
        if (index === 0) {
          path.remove();
        }
      },
    });

    expect(query.where!.conditions).toHaveLength(1);
    expect(query.where!.conditions[0]!.labelKey).toBe('b');
  });
});
