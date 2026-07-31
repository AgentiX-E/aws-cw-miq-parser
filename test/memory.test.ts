// Memory pressure test: verifies the parser does not leak memory
// under sustained load. Parses 10,000 consecutive queries and tracks
// heap usage to detect leaks and degradation.
//
// Run: vitest run test/memory.test.ts

import { describe, it, expect } from 'vitest';
import { parse, serialize, clearParseCache, getParseCacheStats, setParseCacheSize } from '../source/index.js';

const QUERIES = [
  'SELECT AVG(CPUUtilization) FROM "AWS/EC2"',
  'SELECT COUNT(Invocations) FROM SCHEMA("AWS/Lambda", FunctionName)',
  'SELECT MAX(CPUUtilization) FROM "AWS/EC2" WHERE InstanceType = \'m5.large\' GROUP BY InstanceId ORDER BY MAX() DESC LIMIT 10',
  'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer, AvailabilityZone)',
  "SELECT AVG(Duration) FROM SCHEMA(\"AWS/Lambda\", FunctionName) WHERE tag.env = 'prod' GROUP BY FunctionName ORDER BY AVG() DESC LIMIT 20",
  'SELECT MIN(NetworkIn) FROM "AWS/EC2" GROUP BY InstanceId, InstanceType LIMIT 50',
  "SELECT COUNT(CallCount) FROM SCHEMA(\"AWS/Usage\", Class, Resource, Service, Type) WHERE Type = 'API' ORDER BY COUNT() DESC LIMIT 20",
  "SELECT AVG(DiskReadOps) FROM \"AWS/EC2\" WHERE InstanceId = 'i-1234567890abcdef0'",
  "SELECT SUM(NumberOfMessagesPublished) FROM SCHEMA(\"AWS/SNS\", TopicName) GROUP BY TopicName ORDER BY SUM() DESC LIMIT 10",
  "SELECT AVG(VolumeReadBytes) FROM SCHEMA(\"AWS/EBS\", VolumeId) GROUP BY VolumeId",
];

const ITERATIONS = 10_000;

function getHeapUsedMB(): number {
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;
  }
  return 0;
}

describe('Memory pressure — 10K consecutive operations', () => {
  it('parse only: 10,000 iterations without heap growth > 50MB', () => {
    clearParseCache();
    setParseCacheSize(0); // Disable cache to test raw parsing

    const initialHeap = getHeapUsedMB();
    const startTime = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
      const query = QUERIES[i % QUERIES.length]!;
      const ast = parse(query);
      expect(ast.type).toBe('MetricsInsightsQuery');
    }

    const elapsed = performance.now() - startTime;
    const finalHeap = getHeapUsedMB();
    const heapGrowth = finalHeap - initialHeap;

    console.log(`[memory] Parse-only 10K iterations: ${elapsed.toFixed(0)}ms`);
    console.log(`[memory] Heap: ${initialHeap}MB → ${finalHeap}MB (Δ${heapGrowth > 0 ? '+' : ''}${heapGrowth}MB)`);

    // Heap growth > 50MB indicates a potential memory leak
    expect(heapGrowth).toBeLessThan(50);
  }, 30000);

  it('round-trip: 10,000 parse + serialize iterations', () => {
    clearParseCache();
    setParseCacheSize(0);

    const initialHeap = getHeapUsedMB();
    const startTime = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
      const query = QUERIES[i % QUERIES.length]!;
      const ast = parse(query);
      const serialized = serialize(ast);
      expect(serialized).toBeTruthy();
      expect(serialized.length).toBeGreaterThan(10);
    }

    const elapsed = performance.now() - startTime;
    const finalHeap = getHeapUsedMB();
    const heapGrowth = finalHeap - initialHeap;

    console.log(`[memory] Round-trip 10K iterations: ${elapsed.toFixed(0)}ms`);
    console.log(`[memory] Heap: ${initialHeap}MB → ${finalHeap}MB (Δ${heapGrowth > 0 ? '+' : ''}${heapGrowth}MB)`);

    expect(heapGrowth).toBeLessThan(50);
  }, 30000);

  it('parse performance does not degrade over time (last 1K vs first 1K)', () => {
    clearParseCache();
    setParseCacheSize(0);

    // First 1000 iterations
    const firstStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      parse(QUERIES[i % QUERIES.length]!);
    }
    const firstElapsed = performance.now() - firstStart;

    // Skip to near the end, then measure last 1000
    for (let i = 1000; i < ITERATIONS; i++) {
      parse(QUERIES[i % QUERIES.length]!);
    }

    const lastStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      parse(QUERIES[i % QUERIES.length]!);
    }
    const lastElapsed = performance.now() - lastStart;

    const degradation = ((lastElapsed - firstElapsed) / firstElapsed * 100);
    console.log(`[memory] First 1K: ${firstElapsed.toFixed(2)}ms, Last 1K: ${lastElapsed.toFixed(2)}ms (${degradation > 0 ? '+' : ''}${degradation.toFixed(1)}%)`);

    // Degradation > 50% indicates JIT deopt or memory pressure
    expect(degradation).toBeLessThan(50);
  }, 60000);
});

describe('Memory pressure — cache behavior', () => {
  it('cache hit reduces parse time for repeated queries', () => {
    clearParseCache();
    setParseCacheSize(256);

    const query = QUERIES[0]!;
    const batchSize = 10_000;

    // First parse (cold)
    const coldStart = performance.now();
    for (let i = 0; i < batchSize; i++) {
      parse(query);
    }
    const coldTime = performance.now() - coldStart;

    // Cache should now be warm
    expect(getParseCacheStats().size).toBe(1);

    // Second batch (cache hits)
    const warmStart = performance.now();
    for (let i = 0; i < batchSize; i++) {
      parse(query);
    }
    const warmTime = performance.now() - warmStart;

    console.log(`[memory] Cold ${batchSize}: ${coldTime.toFixed(2)}ms, Warm ${batchSize}: ${warmTime.toFixed(2)}ms`);
    console.log(`[memory] Speedup: ${(coldTime / Math.max(warmTime, 0.001)).toFixed(1)}x`);

    // Cache hits should be significantly faster (at minimum, no regression)
    expect(warmTime).toBeLessThanOrEqual(coldTime);
  });
});
