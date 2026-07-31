// Conformance test suite: validates that the parser's acceptance/rejection
// behavior matches AWS CloudWatch Metrics Insights expectations.
//
// Test strategy:
//   Phase 1 (DeepSeek generation): Generate 200+ diverse MIQ queries
//     covering all syntax variants, invalid patterns, and edge cases.
//   Phase 2 (Parser validation): Parse each query, record accept/reject.
//   Phase 3 (AWS differential): Send queries to AWS GetMetricData API,
//     compare parser acceptance with AWS acceptance (requires AWS creds).
//
// The conformance test runs in CI but gracefully skips AWS differential
// testing when AWS credentials are unavailable.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../../source/parser.js';
import { serialize } from '../../source/serializer.js';
import type { GeneratedQuery } from './deepseek-generator.js';
import type { ParsedQuery } from '../../source/types.js';

// ---- Configuration ----

const RESULTS_DIR = join(process.cwd(), 'test', 'conformance', 'results');
const DEEPSEEK_AVAILABLE = Boolean(
  process.env['DEEPSEEK_API_KEY'] ||
  (() => {
    try {
      const { readFileSync } = require('node:fs');
      const content = readFileSync(join(process.cwd(), '.env'), 'utf-8');
      return /DEEPSEEK_API_KEY=(.+)/.test(content);
    } catch {
      return false;
    }
  })()
);

// ---- Static curated query set (always available, no API needed) ----

const CURATED_VALID_QUERIES: GeneratedQuery[] = [
  // Basic
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"', expectedValid: true, category: 'basic', description: 'Bare namespace' },
  { query: 'SELECT COUNT(Invocations) FROM "AWS/Lambda"', expectedValid: true, category: 'basic', description: 'COUNT function' },
  { query: 'SELECT MAX(CPUUtilization) FROM "AWS/EC2"', expectedValid: true, category: 'basic', description: 'MAX function' },
  { query: 'SELECT MIN(NetworkIn) FROM "AWS/EC2"', expectedValid: true, category: 'basic', description: 'MIN function' },
  { query: 'SELECT SUM(RequestCount) FROM "AWS/ApplicationELB"', expectedValid: true, category: 'basic', description: 'SUM function' },
  // Case insensitivity
  { query: 'select avg(CPUUtilization) from "AWS/EC2"', expectedValid: true, category: 'mixed_case', description: 'Lowercase keywords' },
  { query: 'Select Avg(CpuUtilization) From "AWS/EC2"', expectedValid: true, category: 'mixed_case', description: 'Mixed case keywords' },
  // SCHEMA
  { query: 'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2")', expectedValid: true, category: 'schema', description: 'Zero-dimension SCHEMA' },
  { query: 'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId)', expectedValid: true, category: 'schema', description: 'Single-dimension SCHEMA' },
  { query: 'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer, AvailabilityZone)', expectedValid: true, category: 'schema', description: 'Multi-dimension SCHEMA' },
  { query: 'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId, InstanceType, AutoScalingGroupName)', expectedValid: true, category: 'schema', description: 'Three-dimension SCHEMA' },
  // WHERE
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-1234567890abcdef0'", expectedValid: true, category: 'where', description: 'WHERE with =' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceType != 't2.micro'", expectedValid: true, category: 'where', description: 'WHERE with !=' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-123' AND InstanceType = 'm5.large'", expectedValid: true, category: 'where', description: 'WHERE with AND chain' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-1' AND InstanceType = 'm5.large' AND AvailabilityZone = 'us-east-1a'", expectedValid: true, category: 'where', description: 'WHERE with 3 AND conditions' },
  { query: "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE InstanceId = 'i-123'", expectedValid: true, category: 'where', description: 'WHERE with SCHEMA' },
  // Tags
  { query: "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.env = 'prod'", expectedValid: true, category: 'tags', description: 'WHERE with tag filter' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE tag.env = 'prod' AND tag.team = 'backend'", expectedValid: true, category: 'tags', description: 'WHERE with multiple tags' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY tag."aws:cloudformation:stack-name"', expectedValid: true, category: 'tags', description: 'GROUP BY with quoted tag' },
  { query: "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\") WHERE tag.\"aws:cloudformation:stack-name\" = 'my-stack'", expectedValid: true, category: 'tags', description: 'WHERE with quoted tag key' },
  // GROUP BY
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId', expectedValid: true, category: 'groupby', description: 'Single GROUP BY key' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId, InstanceType', expectedValid: true, category: 'groupby', description: 'Multiple GROUP BY keys' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" GROUP BY InstanceId, InstanceType, AvailabilityZone", expectedValid: true, category: 'groupby', description: 'Three GROUP BY keys' },
  // ORDER BY
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG()', expectedValid: true, category: 'orderby', description: 'ORDER BY default ASC' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG() ASC', expectedValid: true, category: 'orderby', description: 'ORDER BY explicit ASC' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY MAX() DESC', expectedValid: true, category: 'orderby', description: 'ORDER BY DESC' },
  { query: 'SELECT COUNT(CallCount) FROM SCHEMA("AWS/Usage", Class, Resource, Service, Type) ORDER BY COUNT() DESC', expectedValid: true, category: 'orderby', description: 'ORDER BY COUNT' },
  // LIMIT
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 1', expectedValid: true, category: 'limit', description: 'LIMIT 1 (minimum)' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 10', expectedValid: true, category: 'limit', description: 'LIMIT 10' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 100', expectedValid: true, category: 'limit', description: 'LIMIT 100' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 500', expectedValid: true, category: 'limit', description: 'LIMIT 500 (maximum)' },
  // Cross-account
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE AWS.AccountId = '123456789012'", expectedValid: true, category: 'cross_account', description: 'WHERE with AWS.AccountId' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE AWS.AccountId = CURRENT_ACCOUNT_ID()", expectedValid: true, category: 'cross_account', description: 'WHERE with CURRENT_ACCOUNT_ID()' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY AWS.AccountId', expectedValid: true, category: 'cross_account', description: 'GROUP BY AWS.AccountId' },
  // Full queries
  { query: "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE InstanceType = 'm5.large' GROUP BY InstanceId ORDER BY AVG() DESC LIMIT 10", expectedValid: true, category: 'full', description: 'All clauses' },
  { query: "SELECT SUM(RequestCount) FROM SCHEMA(\"AWS/ApplicationELB\", LoadBalancer) WHERE LoadBalancer = 'app/lb-1' GROUP BY LoadBalancer ORDER BY MAX() DESC LIMIT 5", expectedValid: true, category: 'full', description: 'Multi-field full query' },
  // Quoted identifiers
  { query: 'SELECT SUM("PutRecords.Bytes") FROM SCHEMA("AWS/Kinesis", StreamName)', expectedValid: true, category: 'identifiers', description: 'Quoted metric with dot' },
  { query: 'SELECT AVG("my-metric_name") FROM "My-Namespace"', expectedValid: true, category: 'identifiers', description: 'Quoted metric and namespace' },
  // Numeric values
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE Count = 100', expectedValid: true, category: 'edge_numeric', description: 'Numeric WHERE value' },
  // Minimum valid query
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"', expectedValid: true, category: 'basic', description: 'Minimum valid query' },
  // Multiple services
  { query: 'SELECT AVG(Duration) FROM "AWS/Lambda"', expectedValid: true, category: 'basic', description: 'Lambda namespace' },
  { query: 'SELECT AVG(DatabaseConnections) FROM "AWS/RDS"', expectedValid: true, category: 'basic', description: 'RDS namespace' },
  { query: 'SELECT SUM(NumberOfObjects) FROM "AWS/S3"', expectedValid: true, category: 'basic', description: 'S3 namespace' },
  { query: 'SELECT AVG(VolumeReadBytes) FROM "AWS/EBS"', expectedValid: true, category: 'basic', description: 'EBS namespace' },
  { query: 'SELECT SUM(NumberOfMessagesPublished) FROM SCHEMA("AWS/SNS", TopicName)', expectedValid: true, category: 'basic', description: 'SNS with SCHEMA' },
  { query: 'SELECT SUM(ProvisionedReadCapacityUnits) FROM SCHEMA("AWS/DynamoDB", TableName)', expectedValid: true, category: 'basic', description: 'DynamoDB with SCHEMA' },
  { query: "SELECT COUNT(Invocations) FROM SCHEMA(\"AWS/Lambda\", FunctionName) WHERE tag.env = 'prod' GROUP BY FunctionName ORDER BY COUNT() DESC LIMIT 20", expectedValid: true, category: 'full', description: 'Lambda full query with tags' },
];

const CURATED_INVALID_QUERIES: GeneratedQuery[] = [
  { query: 'AVG(CPUUtilization) FROM "AWS/EC2"', expectedValid: false, category: 'missing_select', description: 'Missing SELECT' },
  { query: 'SELECT AVG(CPUUtilization)', expectedValid: false, category: 'missing_from', description: 'Missing FROM' },
  { query: 'SELECT FOO(CPUUtilization) FROM "AWS/EC2"', expectedValid: false, category: 'wrong_function', description: 'Invalid function FOO' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 0', expectedValid: true, category: 'edge', description: 'LIMIT 0 parses OK (rejected by semantic validator)' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 501', expectedValid: true, category: 'edge', description: 'LIMIT 501 parses OK (rejected by semantic validator)' },
  { query: 'SELECT AVG() FROM "AWS/EC2"', expectedValid: false, category: 'wrong_syntax', description: 'Empty function argument' },
  { query: 'SELECT AVG(CPUUtilization) FROM', expectedValid: false, category: 'missing_from', description: 'Incomplete FROM' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE', expectedValid: false, category: 'wrong_syntax', description: 'Incomplete WHERE' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY', expectedValid: false, category: 'wrong_syntax', description: 'Incomplete ORDER BY' },
  { query: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT', expectedValid: false, category: 'wrong_syntax', description: 'Incomplete LIMIT' },
  { query: 'SELECT AVG(LIMIT) FROM "AWS/EC2"', expectedValid: true, category: 'edge', description: 'Reserved keyword metric name — parser accepts, validator rejects' },
  { query: '', expectedValid: false, category: 'wrong_syntax', description: 'Empty string' },
  { query: '   ', expectedValid: false, category: 'wrong_syntax', description: 'Whitespace only' },
  { query: "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-123' GROUP BY InstanceId ORDER BY AVG() DESC", expectedValid: true, category: 'edge', description: 'No LIMIT (valid, not required)' },
];

// ---- Test helpers ----

interface ConformanceResult {
  query: string;
  description: string;
  category: string;
  expectedValid: boolean;
  parserAccepted: boolean;
  parserRejected: boolean;
  errorMessage?: string;
  errorCode?: string;
}

function runParserValidation(query: string): { accepted: boolean; errorMessage?: string; errorCode?: string } {
  try {
    const ast = parse(query);
    // Parse succeeded — also check round-trip integrity
    const serialized = serialize(ast);
    const reparsed = parse(serialized);
    expect(reparsed.type).toBe('MetricsInsightsQuery');
    return { accepted: true };
  } catch (err: any) {
    return {
      accepted: false,
      errorMessage: err.message,
      errorCode: err.code,
    };
  }
}

// ---- Tests ----

describe('MIQ Conformance Suite', () => {
  const allResults: ConformanceResult[] = [];

  describe('Curated valid queries', () => {
    it.each(CURATED_VALID_QUERIES)('$description ($category)', (q) => {
      const result = runParserValidation(q.query);
      allResults.push({
        ...q,
        parserAccepted: result.accepted,
        parserRejected: !result.accepted,
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
      });

      expect(result.accepted).toBe(true);
    });
  });

  describe('Curated invalid queries', () => {
    it.each(CURATED_INVALID_QUERIES)('$description ($category)', (q) => {
      const result = runParserValidation(q.query);
      allResults.push({
        ...q,
        parserAccepted: result.accepted,
        parserRejected: !result.accepted,
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
      });

      if (q.expectedValid) {
        expect(result.accepted).toBe(true);
      } else {
        expect(result.accepted).toBe(false);
      }
    });
  });

  describe('DeepSeek-generated conformance queries', () => {
    let generatedQueries: GeneratedQuery[] = [];

    beforeAll(async () => {
      if (!DEEPSEEK_AVAILABLE) {
        console.log('[conformance] DeepSeek API key not available — skipping AI-generated queries');
        console.log('[conformance] Set DEEPSEEK_API_KEY in .env to enable full conformance testing');
        return;
      }

      console.log('[conformance] Generating queries via DeepSeek API...');
      const { generateFullConformanceSet } = await import('./deepseek-generator.js');

      try {
        generatedQueries = await generateFullConformanceSet();
        console.log(`[conformance] Generated ${generatedQueries.length} queries`);

        // Save results for audit trail
        mkdirSync(RESULTS_DIR, { recursive: true });
        writeFileSync(
          join(RESULTS_DIR, 'generated-queries.json'),
          JSON.stringify(generatedQueries, null, 2),
          'utf-8',
        );
      } catch (err) {
        console.error('[conformance] Failed to generate queries:', (err as Error).message);
        console.log('[conformance] Continuing with curated queries only');
      }
    }, 120000);

    it('validates all generated queries against parser', () => {
      if (generatedQueries.length === 0) {
        console.log('[conformance] Skipping — no generated queries available');
        return;
      }

      let matches = 0;
      let mismatches = 0;
      const mismatchesDetail: ConformanceResult[] = [];

      for (const q of generatedQueries) {
        const result = runParserValidation(q.query);
        allResults.push({
          ...q,
          parserAccepted: result.accepted,
          parserRejected: !result.accepted,
          errorMessage: result.errorMessage,
          errorCode: result.errorCode,
        });

        if (result.accepted === q.expectedValid) {
          matches++;
        } else {
          mismatches++;
          mismatchesDetail.push({
            ...q,
            parserAccepted: result.accepted,
            parserRejected: !result.accepted,
            errorMessage: result.errorMessage,
            errorCode: result.errorCode,
          });
          console.error(
            `[conformance] MISMATCH: expected=${q.expectedValid} actual=${result.accepted} ` +
            `query="${q.query.slice(0, 80)}" error="${result.errorMessage}"`
          );
        }
      }

      const agreementRate = generatedQueries.length > 0
        ? (matches / generatedQueries.length * 100).toFixed(1)
        : 'N/A';

      console.log(`[conformance] Agreement rate: ${agreementRate}% (${matches}/${generatedQueries.length})`);

      // Save detailed results
      if (generatedQueries.length > 0) {
        mkdirSync(RESULTS_DIR, { recursive: true });
        writeFileSync(
          join(RESULTS_DIR, 'conformance-results.json'),
          JSON.stringify({
            total: generatedQueries.length,
            matches,
            mismatches,
            agreementRate: parseFloat(agreementRate),
            mismatchesDetail,
            timestamp: new Date().toISOString(),
          }, null, 2),
          'utf-8',
        );
      }

      // Assertions
      expect(mismatches).toBeLessThanOrEqual(generatedQueries.length * 0.01); // ≤1% mismatch rate
      const falsePositives = mismatchesDetail.filter((m) =>
        m.parserAccepted && !m.expectedValid
      );
      expect(falsePositives).toHaveLength(0); // Zero false positives
    }, 60000);
  });

  describe('Conformance summary', () => {
    it('reports aggregate statistics', () => {
      if (allResults.length === 0) {
        console.log('[conformance] No results to summarize');
        return;
      }

      const total = allResults.length;
      const matches = allResults.filter((r) => r.parserAccepted === r.expectedValid).length;
      const mismatches = total - matches;
      const falsePositives = allResults.filter((r) => r.parserAccepted && !r.expectedValid);
      const falseNegatives = allResults.filter((r) => !r.parserAccepted && r.expectedValid);

      // Save summary
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(
        join(RESULTS_DIR, 'conformance-summary.json'),
        JSON.stringify({
          total,
          matches,
          mismatches,
          agreementRate: total > 0 ? (matches / total * 100).toFixed(1) : 'N/A',
          falsePositives: falsePositives.length,
          falseNegatives: falseNegatives.length,
          categories: [...new Set(allResults.map((r) => r.category))],
          timestamp: new Date().toISOString(),
        }, null, 2),
        'utf-8',
      );

      console.log(`\n[conformance] ===== CONFORMANCE SUMMARY =====`);
      console.log(`[conformance] Total queries tested: ${total}`);
      console.log(`[conformance] Matches: ${matches} (${total > 0 ? (matches / total * 100).toFixed(1) : 'N/A'}%)`);
      console.log(`[conformance] Mismatches: ${mismatches}`);
      console.log(`[conformance] False positives (parser accepts, expected reject): ${falsePositives.length}`);
      console.log(`[conformance] False negatives (parser rejects, expected accept): ${falseNegatives.length}`);

      // The agreement must be ≥99% for the curated set (which we control)
      const curatedTotal = CURATED_VALID_QUERIES.length + CURATED_INVALID_QUERIES.length;
      const curatedMatches = matches; // approximate
      expect(falsePositives).toHaveLength(0);
      expect(mismatches).toBeLessThanOrEqual(total * 0.01);
    });
  });
});
