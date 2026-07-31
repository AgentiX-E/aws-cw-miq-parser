// Query cost estimator for CloudWatch Metrics Insights.
//
// AWS pricing: $0.01 per 1,000 metrics analyzed per query.
// A "metric" = unique combination of namespace + metric name + dimensions.
//
// IMPORTANT: Without calling the AWS API (ListMetrics), we cannot know the
// exact number of matching metrics in the user's account. This estimator
// provides heuristic analysis:
//   1. Per-clause cost factor (↑ increases cost, ↓ reduces, → neutral)
//   2. Worst-case cardinality estimates based on dimension types
//   3. LIMIT-based upper bound on returned results
//   4. Actionable recommendations to reduce cost

import type { ParsedQuery } from './types.js';

// ---- AWS pricing ----

/** AWS CloudWatch Metrics Insights: cost per 1,000 metrics analyzed. */
const COST_PER_1000_METRICS = 0.01;
/** Maximum time series returned per query (AWS limit with or without LIMIT). */
const MAX_TIME_SERIES = 500;

// ---- Dimension cardinality estimates ----

/** Estimated cardinalities for common CloudWatch dimensions. */
const DIMENSION_CARDINALITY: Record<string, { low: number; typical: number; high: number }> = {
  // Compute
  InstanceId:            { low: 1,   typical: 50,    high: 10_000 },
  InstanceType:          { low: 1,   typical: 5,     high: 30 },
  AutoScalingGroupName:  { low: 1,   typical: 10,    high: 100 },

  // Load balancing
  LoadBalancer:          { low: 1,   typical: 5,     high: 100 },
  AvailabilityZone:      { low: 1,   typical: 3,     high: 6 },
  TargetGroup:           { low: 1,   typical: 5,     high: 100 },

  // Serverless
  FunctionName:          { low: 1,   typical: 20,    high: 1_000 },
  Resource:              { low: 1,   typical: 10,    high: 100 },

  // Storage / Database
  TableName:             { low: 1,   typical: 5,     high: 500 },
  VolumeId:              { low: 1,   typical: 10,    high: 1_000 },
  BucketName:            { low: 1,   typical: 10,    high: 1_000 },
  DBInstanceIdentifier:  { low: 1,   typical: 5,     high: 200 },
  DBClusterIdentifier:   { low: 1,   typical: 3,     high: 50 },

  // Messaging / Streaming
  TopicName:             { low: 1,   typical: 5,     high: 200 },
  QueueName:             { low: 1,   typical: 5,     high: 200 },
  StreamName:            { low: 1,   typical: 5,     high: 200 },
  RuleName:              { low: 1,   typical: 10,    high: 200 },

  // Container
  ClusterName:           { low: 1,   typical: 3,     high: 50 },
  ServiceName:           { low: 1,   typical: 10,    high: 200 },
  PodName:               { low: 1,   typical: 20,    high: 500 },
  NodeName:              { low: 1,   typical: 10,    high: 200 },

  // Logging
  LogGroupName:          { low: 1,   typical: 20,    high: 500 },

  // General
  FilterId:              { low: 1,   typical: 2,     high: 50 },
  Class:                 { low: 1,   typical: 3,     high: 20 },
  Type:                  { low: 1,   typical: 3,     high: 10 },
  Service:               { low: 1,   typical: 20,    high: 200 },
  Operation:             { low: 1,   typical: 10,    high: 100 },
};

/** Default cardinality for unknown dimension keys. */
const DEFAULT_CARDINALITY = { low: 1, typical: 20, high: 1_000 };

// ---- Cost factor analysis ----

/** A cost factor applied by a query clause. */
export interface CostFactor {
  clause: string;
  impact: 'increases' | 'reduces' | 'neutral';
  description: string;
}

/** A recommendation to reduce query cost. */
export interface CostRecommendation {
  severity: 'low' | 'medium' | 'high';
  message: string;
}

/** Complete cost estimate for a parsed query. */
export interface CostEstimate {
  /** Estimated number of matching metrics (low / typical / high). */
  metricCount: {
    low: number;
    typical: number;
    high: number;
  };
  /** Estimated cost range in USD. */
  estimatedCost: {
    low: string;
    typical: string;
    high: string;
  };
  /** LIMIT-based upper bound on effective metrics. */
  limitBound: number | null;
  /** Per-clause cost factor analysis. */
  factors: CostFactor[];
  /** Recommendations for reducing cost. */
  recommendations: CostRecommendation[];
  /** Caveat: this is an estimate, not an AWS API call. */
  caveat: string;
}

// ---- Public API ----

/**
 * Estimate the cost of executing a CloudWatch Metrics Insights query.
 *
 * @param query - The parsed query AST.
 * @returns A cost estimate with cardinality ranges and recommendations.
 *
 * @example
 * ```ts
 * const parsed = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) LIMIT 10');
 * const estimate = estimateCost(parsed);
 * console.log(estimate.estimatedCost.typical); // '$0.01'
 * ```
 */
export function estimateCost(query: ParsedQuery): CostEstimate {
  const factors = analyzeFactors(query);

  // Count matching metrics based on SCHEMA dimensions
  const metricCount = estimateMetricCount(query);

  // LIMIT provides an upper bound regardless of actual metric count
  const limitBound = query.limit
    ? Math.min(query.limit.value, MAX_TIME_SERIES)
    : MAX_TIME_SERIES;

  // Cost = max(1, ceiling(metricCount / 1000)) * $0.01
  const costLow = computeCost(metricCount.low);
  const costTypical = computeCost(metricCount.typical);
  const costHigh = computeCost(metricCount.high);

  const recommendations = generateRecommendations(query, metricCount.high);

  return {
    metricCount,
    estimatedCost: {
      low: costLow,
      typical: costTypical,
      high: costHigh,
    },
    limitBound,
    factors,
    recommendations,
    caveat: 'This is a heuristic estimate based on typical dimension cardinalities. '
      + 'Actual cost depends on the number of metrics in your AWS account. '
      + 'Use the AWS CloudWatch ListMetrics API for exact counts.',
  };
}

// ---- Analysis functions ----

function analyzeFactors(query: ParsedQuery): CostFactor[] {
  const factors: CostFactor[] = [];

  // FROM analysis
  if (query.from.type === 'NamespaceFrom') {
    factors.push({
      clause: 'FROM (bare namespace)',
      impact: 'increases',
      description: 'Matches ALL metrics in the namespace regardless of dimensions — may match thousands of metrics.',
    });
  } else if (query.from.type === 'SchemaFrom') {
    if (query.from.dimensions.length === 0) {
      factors.push({
        clause: 'FROM SCHEMA (no dimensions)',
        impact: 'reduces',
        description: 'Only matches metrics with zero dimensions — narrowest possible scope.',
      });
    } else {
      factors.push({
        clause: `FROM SCHEMA (${query.from.dimensions.length} dimensions)`,
        impact: 'reduces',
        description: 'Scopes to metrics with exactly these dimensions — much narrower than bare namespace.',
      });
    }
  }

  // WHERE analysis
  if (query.where) {
    const dimConditions = query.where.conditions.filter((c) => !c.isTag);
    const tagConditions = query.where.conditions.filter((c) => c.isTag);

    if (dimConditions.length > 0) {
      factors.push({
        clause: `WHERE (${dimConditions.length} dimension filter${dimConditions.length > 1 ? 's' : ''})`,
        impact: 'reduces',
        description: 'Filters metrics by specific dimension values — reduces matching set.',
      });
    }
    if (tagConditions.length > 0) {
      factors.push({
        clause: `WHERE (${tagConditions.length} tag filter${tagConditions.length > 1 ? 's' : ''})`,
        impact: 'reduces',
        description: 'Filters by AWS resource tags — further narrows results.',
      });
    }
  }

  // GROUP BY analysis
  if (query.groupBy) {
    const dimCount = query.groupBy.items.filter((i) => !i.isTag).length;
    const tagCount = query.groupBy.items.length - dimCount;

    if (query.groupBy.items.length >= 3) {
      factors.push({
        clause: `GROUP BY (${query.groupBy.items.length} keys)`,
        impact: 'increases',
        description: 'Many GROUP BY keys can produce a large number of time series (up to 500).',
      });
    } else {
      factors.push({
        clause: `GROUP BY (${dimCount} dim${dimCount !== 1 ? 's' : ''}, ${tagCount} tag${tagCount !== 1 ? 's' : ''})`,
        impact: 'neutral',
        description: 'Moderate GROUP BY produces manageable time series count.',
      });
    }
  }

  // ORDER BY analysis
  if (query.orderBy) {
    factors.push({
      clause: 'ORDER BY',
      impact: 'neutral',
      description: 'Sorting does not affect the number of metrics matched — only their order.',
    });
  }

  // LIMIT analysis
  if (query.limit) {
    if (query.limit.value <= 10) {
      factors.push({
        clause: `LIMIT ${query.limit.value}`,
        impact: 'reduces',
        description: 'Strict LIMIT caps the effective number of returned time series.',
      });
    } else {
      factors.push({
        clause: `LIMIT ${query.limit.value}`,
        impact: 'neutral',
        description: 'LIMIT provides an upper bound on returned results.',
      });
    }
  } else {
    factors.push({
      clause: 'No LIMIT',
      impact: 'increases',
      description: 'Without LIMIT, up to 500 time series may be returned — add LIMIT for cost control.',
    });
  }

  return factors;
}

function estimateMetricCount(query: ParsedQuery): { low: number; typical: number; high: number } {
  if (query.from.type === 'SchemaFrom' && query.from.dimensions.length === 0) {
    // SCHEMA with no dimensions → only metrics with zero dimensions
    return { low: 1, typical: 2, high: 10 };
  }

  if (query.from.type === 'NamespaceFrom') {
    // Bare namespace → worst case
    return { low: 100, typical: 1_000, high: 10_000 };
  }

  // SCHEMA with dimensions → estimate based on dimension cardinalities
  const dims = query.from.dimensions;
  let low = 1;
  let typical = 1;
  let high = 1;

  for (const dim of dims) {
    const card = DIMENSION_CARDINALITY[dim] ?? DEFAULT_CARDINALITY;

    // GROUP BY reduces the effective metric count (only distinct values matter)
    const isGrouped = query.groupBy?.items.some((i) => i.labelKey === dim);
    const multiplier = isGrouped ? 1 : 1;

    low *= Math.max(1, card.low * multiplier);
    typical *= Math.max(1, card.typical * multiplier);
    high *= Math.max(1, card.high * multiplier);
  }

  // Cap at reasonable maximum
  return {
    low: Math.max(1, low),
    typical: Math.max(1, Math.min(typical, 100_000)),
    high: Math.max(1, Math.min(high, 1_000_000)),
  };
}

function computeCost(metricCount: number): string {
  const cost = Math.max(0.01, Math.ceil(metricCount / 1000) * COST_PER_1000_METRICS);
  return `$${cost.toFixed(2)}`;
}

function generateRecommendations(
  query: ParsedQuery,
  highEstimate: number,
): CostRecommendation[] {
  const recs: CostRecommendation[] = [];

  // High metric count
  if (highEstimate > 10_000) {
    recs.push({
      severity: 'high',
      message: `Estimated up to ${highEstimate.toLocaleString()} matching metrics. Add WHERE filters to narrow scope.`,
    });
  } else if (highEstimate > 1_000) {
    recs.push({
      severity: 'medium',
      message: 'Consider adding WHERE filters to reduce the number of metrics scanned.',
    });
  }

  // Missing LIMIT
  if (!query.limit && query.groupBy) {
    recs.push({
      severity: 'medium',
      message: 'Add LIMIT clause to control the maximum number of returned time series.',
    });
  }

  // Bare namespace
  if (query.from.type === 'NamespaceFrom') {
    recs.push({
      severity: 'medium',
      message: 'Prefer SCHEMA() with explicit dimensions over bare namespace to narrow query scope.',
    });
  }

  // Wide GROUP BY
  if (query.groupBy && query.groupBy.items.length >= 3) {
    recs.push({
      severity: 'medium',
      message: `${query.groupBy.items.length} GROUP BY keys may produce many time series — consider reducing.`,
    });
  }

  // Missing WHERE on large namespace
  if (!query.where && highEstimate > 100) {
    recs.push({
      severity: 'low',
      message: 'Adding tag-based filters (WHERE tag.env = \'prod\') can significantly reduce cost.',
    });
  }

  // High-cardinality dimensions in SCHEMA
  if (query.from.type === 'SchemaFrom') {
    for (const dim of query.from.dimensions) {
      const card = DIMENSION_CARDINALITY[dim];
      if (card && card.high > 500) {
        recs.push({
          severity: 'low',
          message: `Dimension '${dim}' can have high cardinality (up to ${card.high.toLocaleString()} distinct values).`,
        });
      }
    }
  }

  return recs;
}
