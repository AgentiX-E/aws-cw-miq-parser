// DeepSeek-powered MIQ query generator for conformance testing.
//
// Uses the DeepSeek API (deepseek-chat model) to generate diverse
// CloudWatch Metrics Insights queries covering all documented syntax
// variants, edge cases, and invalid queries for negative testing.
//
// DeepSeek API key must be provided via DEEPSEEK_API_KEY environment
// variable (set in .env, not checked into git).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

function getApiKey(): string {
  // Try environment variable first
  if (process.env['DEEPSEEK_API_KEY']) {
    return process.env['DEEPSEEK_API_KEY'];
  }
  // Fall back to .env file
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/DEEPSEEK_API_KEY=(.+)/);
    if (match?.[1]) return match[1].trim();
  } catch {
    // .env not found
  }
  throw new Error(
    'DEEPSEEK_API_KEY not found. Set it in .env file or DEEPSEEK_API_KEY environment variable.'
  );
}

export interface GeneratedQuery {
  query: string;
  expectedValid: boolean;
  category: string;
  description: string;
}

interface DeepSeekResponse {
  choices: { message: { content: string } }[];
}

async function callDeepSeek(prompt: string): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            'You are a CloudWatch Metrics Insights query generator. ' +
            'Output ONLY valid JSON arrays of query objects. No markdown, no explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as DeepSeekResponse;
  return data.choices[0]?.message?.content ?? '';
}

function parseQueryArray(raw: string): GeneratedQuery[] {
  // Strip markdown code fences if present
  let json = raw.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(json) as GeneratedQuery[];
}

/**
 * Generate valid MIQ queries covering all documented syntax variants.
 * Returns queries with known-to-be-valid patterns for positive testing.
 */
export async function generateValidQueries(count: number = 100): Promise<GeneratedQuery[]> {
  const prompt = `Generate ${count} valid CloudWatch Metrics Insights (MIQ) queries as a JSON array.
Each query object must have: query, expectedValid (true), category, description.

Categories to cover (distribute evenly):
- basic: Simple SELECT + FROM with bare namespace
- schema: FROM SCHEMA with 0-3 dimensions
- where: WHERE with = and != operators, AND chaining
- tags: WHERE and GROUP BY with tag.keyName and tag."quoted:key"
- groupby: GROUP BY with 1-3 dimension keys
- orderby: ORDER BY with ASC/DESC
- limit: LIMIT with various values (1, 10, 100, 500)
- cross_account: AWS.AccountId and CURRENT_ACCOUNT_ID()
- full: Queries combining all clauses (SELECT + SCHEMA + WHERE + GROUP BY + ORDER BY + LIMIT)
- identifiers: Quoted metric names, quoted namespaces, quoted dimensions
- functions: All 5 aggregation functions (AVG, COUNT, MAX, MIN, SUM)
- mixed_case: Case-insensitive keywords (select, Select, SELECT)
- edge_numeric: WHERE conditions with numeric values
- edge_empty_schema: SCHEMA with zero dimensions

AWS MIQ syntax (documented, no WITH/FILTER/LIKE/BETWEEN/IN/JOIN/HAVING):
- SELECT FUNCTION(metricName) — only AVG/COUNT/MAX/MIN/SUM
- FROM "namespace" | FROM SCHEMA("ns", dim1, dim2, ...)
- WHERE labelKey = 'value' | labelKey != 'value' [AND ...]
- GROUP BY labelKey [, labelKey ...]
- ORDER BY FUNCTION() [ASC|DESC]
- LIMIT 1-500

Use real AWS namespaces: AWS/EC2, AWS/Lambda, AWS/RDS, AWS/S3, AWS/EBS, AWS/ECS,
AWS/DynamoDB, AWS/Usage, AWS/Events, AWS/Kinesis, AWS/ApplicationELB, AWS/Logs,
AWS/SNS, AWS/SQS, ContainerInsights.

Use real metric names: CPUUtilization, MemoryUtilization, DiskReadOps, DiskWriteOps,
NetworkIn, NetworkOut, RequestCount, Duration, Invocations, Errors, Throttles,
CallCount, ProvisionedReadCapacityUnits, ConsumedReadCapacityUnits,
VolumeReadBytes, VolumeWriteBytes.

Use real dimension names: InstanceId, InstanceType, LoadBalancer, AvailabilityZone,
ServiceName, ClusterName, FunctionName, TableName, VolumeId, BucketName,
TopicName, QueueName, RuleName, StreamName, LogGroupName, DBInstanceIdentifier.

Output ONLY a raw JSON array (no markdown, no explanation).`;

  const raw = await callDeepSeek(prompt);
  return parseQueryArray(raw);
}

/**
 * Generate intentionally invalid MIQ queries for negative testing.
 * These queries should be rejected by both the parser and AWS.
 */
export async function generateInvalidQueries(count: number = 60): Promise<GeneratedQuery[]> {
  const prompt = `Generate ${count} intentionally INVALID CloudWatch Metrics Insights queries as a JSON array.
Each object: query, expectedValid (false), category, description.

Invalid categories:
- missing_select: Missing SELECT clause
- missing_from: Missing FROM clause
- wrong_function: Invalid aggregation function (not AVG/COUNT/MAX/MIN/SUM)
- wrong_operator: Invalid comparison operator (not = or !=)
- wrong_syntax: Malformed syntax (unclosed quotes, missing parens, etc.)
- out_of_range: LIMIT < 1 or LIMIT > 500
- reserved_keyword: Unquoted metric name or namespace matching reserved keywords
- wrong_clause_order: Clauses in wrong order (e.g., WHERE before SELECT)
- unsupported_sql: SQL features not in MIQ (LIKE, BETWEEN, IN, JOIN, HAVING, etc.)

Output ONLY a raw JSON array (no markdown, no explanation).`;

  const raw = await callDeepSeek(prompt);
  return parseQueryArray(raw);
}

/**
 * Generate edge-case queries that test parser robustness.
 * These include boundary values, special characters, and unusual patterns.
 */
export async function generateEdgeQueries(count: number = 50): Promise<GeneratedQuery[]> {
  const prompt = `Generate ${count} edge-case CloudWatch Metrics Insights queries as a JSON array.
Each object: query, expectedValid (boolean), category, description.

Edge cases to cover:
- Maximum query length approaching 4096 chars
- LIMIT exactly 1 and exactly 500
- Unicode characters in values
- Multiple consecutive whitespace
- Leading/trailing whitespace
- Mixed single and double quotes
- Nested quotes in identifiers
- Very long dimension names
- Very long tag keys
- Many GROUP BY dimensions (approaching practical limits)
- Many WHERE conditions chained with AND
- All combinations of optional clauses
- Queries with only SELECT + FROM (minimum valid)
- Case variation in identifiers (should be preserved but not normalized)

Output ONLY a raw JSON array (no markdown, no explanation).`;

  const raw = await callDeepSeek(prompt);
  return parseQueryArray(raw);
}

/**
 * Generate a comprehensive conformance query set:
 * - 100 valid queries covering all syntax variants
 * - 60 invalid queries for negative testing
 * - 50 edge-case queries
 * Total: approximately 210 queries
 */
export async function generateFullConformanceSet(): Promise<GeneratedQuery[]> {
  const [valid, invalid, edge] = await Promise.all([
    generateValidQueries(100),
    generateInvalidQueries(60),
    generateEdgeQueries(50),
  ]);

  return [...valid, ...invalid, ...edge];
}
