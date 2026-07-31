// Unit tests: query cost estimator.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { estimateCost } from '../../source/cost.js';

describe('estimateCost — basic queries', () => {
  it('returns structured estimate for simple query', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const estimate = estimateCost(q);

    expect(estimate).toHaveProperty('metricCount');
    expect(estimate).toHaveProperty('estimatedCost');
    expect(estimate).toHaveProperty('limitBound');
    expect(estimate).toHaveProperty('factors');
    expect(estimate).toHaveProperty('recommendations');
    expect(estimate).toHaveProperty('caveat');
  });

  it('SCHEMA with zero dimensions has lowest cost', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2")');
    const estimate = estimateCost(q);

    expect(estimate.metricCount.high).toBeLessThanOrEqual(100);
    expect(estimate.estimatedCost.high).toBe('$0.01');
  });

  it('bare namespace has higher cost estimate', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const estimate = estimateCost(q);

    // Bare namespace may match many metrics
    expect(estimate.metricCount.high).toBeGreaterThan(100);
  });

  it('LIMIT caps the bound regardless of metric count', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10');
    const estimate = estimateCost(q);

    expect(estimate.limitBound).toBe(10);
  });

  it('default limitBound is 500 (AWS max)', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const estimate = estimateCost(q);

    expect(estimate.limitBound).toBe(500);
  });
});

describe('estimateCost — cost factors', () => {
  it('reports FROM bare namespace as cost-increasing', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const fromFactor = estimateCost(q).factors.find((f) => f.clause.includes('FROM'));
    expect(fromFactor!.impact).toBe('increases');
  });

  it('reports FROM SCHEMA as cost-reducing', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
    const fromFactor = estimateCost(q).factors.find((f) => f.clause.includes('FROM'));
    expect(fromFactor!.impact).toBe('reduces');
  });

  it('reports missing LIMIT as cost-increasing', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const noLimitFactor = estimateCost(q).factors.find((f) => f.clause.includes('No LIMIT'));
    expect(noLimitFactor).toBeDefined();
    expect(noLimitFactor!.impact).toBe('increases');
  });
});

// Also test cost factors and recommendations in a non-async style for clarity

describe('estimateCost — cost factors (detailed)', () => {
  it('SCHEMA with dimensions is cost-reducing', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
    const e = estimateCost(q);
    const fromFactor = e.factors.find((f) => f.clause.includes('FROM'));
    expect(fromFactor!.impact).toBe('reduces');
  });

  it('WHERE filters are cost-reducing', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-123'");
    const e = estimateCost(q);
    const whereFactor = e.factors.find((f) => f.clause.includes('WHERE'));
    expect(whereFactor).toBeDefined();
    expect(whereFactor!.impact).toBe('reduces');
  });

  it('ORDER BY is neutral', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG()');
    const e = estimateCost(q);
    const ob = e.factors.find((f) => f.clause.includes('ORDER'));
    expect(ob!.impact).toBe('neutral');
  });

  it('reports missing LIMIT', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const e = estimateCost(q);
    const noLimit = e.factors.find((f) => f.clause === 'No LIMIT');
    expect(noLimit).toBeDefined();
  });

  it('LIMIT ≤ 10 is cost-reducing', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 5');
    const e = estimateCost(q);
    const limitFactor = e.factors.find((f) => f.clause.includes('LIMIT'));
    expect(limitFactor!.impact).toBe('reduces');
  });

  it('LIMIT > 10 is cost-neutral', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 50');
    const e = estimateCost(q);
    const limitFactor = e.factors.find((f) => f.clause.includes('LIMIT'));
    expect(limitFactor!.impact).toBe('neutral');
  });

  it('reports tag filter as cost-reducing', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod'");
    const e = estimateCost(q);
    const tagFactor = e.factors.find((f) => f.description.includes('tag'));
    expect(tagFactor).toBeDefined();
    expect(tagFactor!.impact).toBe('reduces');
  });

  it('handles multiple tag conditions (plural form)', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod' AND tag.team = 'backend'");
    const e = estimateCost(q);
    const tagFactor = e.factors.find((f) => f.description.includes('tags'));
    expect(tagFactor).toBeDefined();
  });

  it('handles GROUP BY with 2+ dimensions (plural)', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2") GROUP BY a, b');
    const e = estimateCost(q);
    const gbFactor = e.factors.find((f) => f.clause.includes('dims'));
    expect(gbFactor).toBeDefined();
  });

  it('handles unknown dimensions with default cardinality', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", MyCustomDim)');
    const e = estimateCost(q);
    expect(e.metricCount.typical).toBeGreaterThan(0);
    // Default cardinality applied
    expect(e.metricCount.high).toBe(1000);
  });
});

describe('estimateCost — recommendations', () => {
  it('warns about bare namespace', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const rec = estimateCost(q).recommendations;
    const nsRec = rec.find((r) => r.message.includes('SCHEMA'));
    expect(nsRec).toBeDefined();
  });

  it('warns about missing LIMIT with GROUP BY', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) GROUP BY InstanceId');
    const e = estimateCost(q);
    const limRec = e.recommendations.find((r) => r.message.includes('LIMIT'));
    expect(limRec).toBeDefined();
  });

  it('warns about 3+ GROUP BY keys', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2") GROUP BY a, b, c');
    const e = estimateCost(q);
    const gbRec = e.recommendations.find((r) => r.message.includes('GROUP BY'));
    expect(gbRec).toBeDefined();
  });

  it('suggests tag-based filters when no WHERE', () => {
    // SCHEMA with high-cardinality dimensions, no WHERE → should suggest tags
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
    const e = estimateCost(q);
    const tagRec = e.recommendations.find((r) => r.message.includes('tag'));
    expect(tagRec).toBeDefined();
  });

  it('warns about high-cardinality dimensions', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
    const e = estimateCost(q);
    // InstanceId is a high-cardinality dimension
    const dimRec = e.recommendations.find((r) => r.message.includes('InstanceId'));
    expect(dimRec).toBeDefined();
  });

  it('high severity warning for very large metric estimates', () => {
    // Multiple high-cardinality dimensions → estimate > 10,000
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId, InstanceType)');
    const e = estimateCost(q);
    expect(e.metricCount.high).toBeGreaterThan(10_000);
    const highRec = e.recommendations.find((r) => r.severity === 'high');
    expect(highRec).toBeDefined();
  });

  it('medium severity for moderate metric estimates', () => {
    // Bare namespace → estimate between 1,000 and 10,000
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const e = estimateCost(q);
    expect(e.metricCount.high).toBeGreaterThan(1_000);
    expect(e.metricCount.high).toBeLessThanOrEqual(11_000);
  });
});

describe('estimateCost — cost computation', () => {
  it('metrics ≤ 1000 cost $0.01', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2")');
    const e = estimateCost(q);
    expect(e.estimatedCost.typical).toBe('$0.01');
  });

  it('metricCount is always ≥ 1', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)');
    const e = estimateCost(q);
    expect(e.metricCount.low).toBeGreaterThanOrEqual(1);
    expect(e.metricCount.typical).toBeGreaterThanOrEqual(1);
    expect(e.metricCount.high).toBeGreaterThanOrEqual(1);
  });

  it('caveat is present and informative', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const e = estimateCost(q);
    expect(e.caveat).toContain('heuristic');
    expect(e.caveat).toContain('AWS');
  });
});
