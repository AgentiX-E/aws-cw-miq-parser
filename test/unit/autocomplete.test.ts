// Unit tests: autocomplete data provider.

import { describe, it, expect } from 'vitest';
import {
  getCompletions,
  getAllKeywords,
  getFunctionNames,
  CLAUSE_KEYWORDS,
  AGGREGATION_FUNCTIONS,
  COMPARISON_OPERATORS,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  SPECIAL_TOKENS,
} from '../../source/autocomplete.js';

describe('autocomplete — data integrity', () => {
  it('CLAUSE_KEYWORDS contains all 6 clause types', () => {
    const labels = CLAUSE_KEYWORDS.map((k) => k.label);
    expect(labels).toContain('SELECT');
    expect(labels).toContain('FROM');
    expect(labels).toContain('WHERE');
    expect(labels).toContain('GROUP BY');
    expect(labels).toContain('ORDER BY');
    expect(labels).toContain('LIMIT');
  });

  it('AGGREGATION_FUNCTIONS contains all 5 functions', () => {
    const labels = AGGREGATION_FUNCTIONS.map((f) => f.label);
    expect(labels).toEqual(['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']);
  });

  it('COMPARISON_OPERATORS contains all 6 operators', () => {
    const labels = COMPARISON_OPERATORS.map((o) => o.label);
    expect(labels).toEqual(['=', '!=', '<', '<=', '>', '>=']);
  });

  it('LOGICAL_OPERATORS contains AND and OR', () => {
    const labels = LOGICAL_OPERATORS.map((l) => l.label);
    expect(labels).toEqual(['AND', 'OR']);
  });

  it('SORT_DIRECTIONS contains ASC and DESC', () => {
    const labels = SORT_DIRECTIONS.map((s) => s.label);
    expect(labels).toEqual(['ASC', 'DESC']);
  });

  it('SPECIAL_TOKENS covers SCHEMA, tag, CURRENT_ACCOUNT_ID, AWS.AccountId', () => {
    const labels = SPECIAL_TOKENS.map((s) => s.label);
    expect(labels).toContain('SCHEMA');
    expect(labels).toContain('tag.');
    expect(labels).toContain('CURRENT_ACCOUNT_ID()');
    expect(labels).toContain('AWS.AccountId');
  });
});

describe('autocomplete — getCompletions', () => {
  it('returns keyword and function completions for empty context', () => {
    const items = getCompletions();
    const keywordItems = items.filter((i) => i.kind === 'keyword');
    const functionItems = items.filter((i) => i.kind === 'function');
    expect(keywordItems.length).toBeGreaterThanOrEqual(6);
    expect(functionItems.length).toBe(5);
  });

  it('returns WHERE-relevant completions when cursor is after WHERE', () => {
    const items = getCompletions({
      textBeforeCursor: 'WHERE ',
      fullText: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE ',
      cursorOffset: 50,
    });
    const operatorItems = items.filter((i) => i.kind === 'operator');
    expect(operatorItems.length).toBeGreaterThanOrEqual(6);
  });

  it('returns ORDER BY direction suggestions', () => {
    const items = getCompletions({
      textBeforeCursor: 'ORDER BY AVG() ',
      fullText: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() ',
      cursorOffset: 60,
    });
    const ascItem = items.find((i) => i.label === 'ASC');
    const descItem = items.find((i) => i.label === 'DESC');
    expect(ascItem).toBeDefined();
    expect(descItem).toBeDefined();
  });

  it('returns special tokens', () => {
    const items = getCompletions();
    const specialItems = items.filter((i) => i.kind === 'special');
    expect(specialItems.length).toBeGreaterThanOrEqual(4);
  });
});

describe('autocomplete — getAllKeywords', () => {
  it('returns non-empty keyword array', () => {
    const keywords = getAllKeywords();
    expect(keywords.length).toBeGreaterThan(20);
    expect(keywords).toContain('SELECT');
    expect(keywords).toContain('AVG');
    expect(keywords).toContain('SCHEMA');
  });
});

describe('autocomplete — getFunctionNames', () => {
  it('returns all 5 aggregation functions', () => {
    const names = getFunctionNames();
    expect(names).toEqual(['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']);
  });
});
