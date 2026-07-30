// Arbitrary generators for fast-check property-based testing.
// Generates random valid and invalid MIQ queries for parser robustness testing.

import fc from 'fast-check';

// ---- Reusable components ----

const functions = fc.constantFrom('AVG', 'COUNT', 'MAX', 'MIN', 'SUM');

const metricNames = fc.oneof(
  fc.constantFrom(
    'CPUUtilization', 'MemoryUtilization', 'DiskReadOps', 'DiskWriteOps',
    'NetworkIn', 'NetworkOut', 'StatusCheckFailed', 'RequestCount',
    'Duration', 'Invocations', 'Errors', 'Throttles', 'CallCount',
    'ProvisionedReadCapacityUnits', 'ProvisionedWriteCapacityUnits',
    'ConsumedReadCapacityUnits', 'ConsumedWriteCapacityUnits',
    'VolumeReadBytes', 'VolumeWriteBytes', 'ActiveConnectionCount',
  ),
  fc.string({ minLength: 3, maxLength: 30 }).map((s) =>
    s.replace(/[^a-zA-Z0-9_.]/g, '_').replace(/^[^a-zA-Z_]/, 'M')
  ),
);

const namespaces = fc.oneof(
  fc.constantFrom(
    'AWS/EC2', 'AWS/Lambda', 'AWS/RDS', 'AWS/S3', 'AWS/EBS',
    'AWS/ECS', 'AWS/DynamoDB', 'AWS/Usage', 'AWS/Events',
    'AWS/Kinesis', 'AWS/ApplicationELB', 'AWS/Logs', 'AWS/SNS',
    'AWS/SQS', 'ContainerInsights', 'ECS/ContainerInsights',
  ),
  fc.string({ minLength: 3, maxLength: 20 }).map((s) =>
    s.replace(/[^a-zA-Z0-9_/]/g, '_').replace(/^[^a-zA-Z_]/, 'NS_')
  ),
);

const dimensionKeys = fc.constantFrom(
  'InstanceId', 'InstanceType', 'LoadBalancer', 'AvailabilityZone',
  'ServiceName', 'ClusterName', 'FunctionName', 'TableName',
  'VolumeId', 'BucketName', 'TopicName', 'QueueName', 'RuleName',
  'StreamName', 'LogGroupName', 'DBInstanceIdentifier',
);

const comparisonOperators = fc.constantFrom('=', '!=', '<', '<=', '>', '>=');

const stringValues = fc.string({ minLength: 1, maxLength: 20 }).map((s) =>
  s.replace(/[^a-zA-Z0-9_.\-]/g, '_')
);

const orderDirections = fc.constantFrom('ASC', 'DESC');

// ---- Query builders ----

/** Arbitrary: a simple valid MIQ query (bare namespace, single condition). */
export function arbitrarySimpleQuery(): fc.Arbitrary<string> {
  return fc.record({
    func: functions,
    metric: metricNames,
    ns: namespaces,
  }).map(({ func, metric, ns }) =>
    `SELECT ${func}(${maybeQuote(metric)}) FROM ${maybeQuote(ns)}`
  );
}

/** Arbitrary: a valid MIQ query with all optional clauses. */
export function arbitraryFullQuery(): fc.Arbitrary<string> {
  return fc.record({
    func: functions,
    metric: metricNames,
    ns: namespaces,
    useSchema: fc.boolean(),
    dims: fc.array(dimensionKeys, { minLength: 1, maxLength: 3 }),
    whereCount: fc.nat(3),
    whereKeys: fc.array(dimensionKeys, { minLength: 1, maxLength: 5 }),
    op: comparisonOperators,
    val: stringValues,
    groupByCount: fc.nat(3),
    orderFunc: functions,
    orderDir: orderDirections,
    limitVal: fc.integer({ min: 1, max: 500 }),
  }).map((r) => {
    let q = `SELECT ${r.func}(${maybeQuote(r.metric)}) `;

    if (r.useSchema) {
      q += `FROM SCHEMA(${maybeQuote(r.ns)}${r.dims.length ? ', ' + r.dims.join(', ') : ''}) `;
    } else {
      q += `FROM ${maybeQuote(r.ns)} `;
    }

    if (r.whereCount > 0) {
      const conditions = r.whereKeys.slice(0, r.whereCount).map((k, i) =>
        `${i > 0 ? 'AND ' : ''}${k} ${r.op} '${r.val}'`
      );
      q += `WHERE ${conditions.join(' ')} `;
    }

    if (r.groupByCount > 0) {
      const groups = r.dims.slice(0, Math.min(r.groupByCount, r.dims.length));
      q += `GROUP BY ${groups.join(', ')} `;
    }

    q += `ORDER BY ${r.orderFunc}() ${r.orderDir} `;
    q += `LIMIT ${r.limitVal}`;

    return q.trim();
  });
}

/** Arbitrary: a semantically consistent valid query (matching WHERE keys to dimensions). */
export function arbitraryConsistentQuery(): fc.Arbitrary<string> {
  return fc.record({
    func: functions,
    metric: metricNames,
    ns: namespaces,
    dims: fc.array(dimensionKeys, { minLength: 1, maxLength: 3 }),
    whereCount: fc.nat(3),
    groupByCount: fc.nat(2),
    orderFunc: functions,
    orderDir: orderDirections,
    limitVal: fc.integer({ min: 1, max: 500 }),
  }).map((r) => {
    const uniqueDims = [...new Set(r.dims)];
    let q = `SELECT ${r.func}(${maybeQuote(r.metric)}) `;
    q += `FROM SCHEMA(${maybeQuote(r.ns)}${uniqueDims.length ? ', ' + uniqueDims.join(', ') : ''}) `;

    if (r.whereCount > 0 && uniqueDims.length > 0) {
      const conditions = uniqueDims.slice(0, r.whereCount).map((k, i) =>
        `${i > 0 ? 'AND ' : ''}${k} = 'testval'`
      );
      q += `WHERE ${conditions.join(' ')} `;
    }

    if (r.groupByCount > 0 && uniqueDims.length > 0) {
      const groups = uniqueDims.slice(0, Math.min(r.groupByCount, uniqueDims.length));
      q += `GROUP BY ${groups.join(', ')} `;
    }

    q += `ORDER BY ${r.orderFunc}() ${r.orderDir} `;
    q += `LIMIT ${r.limitVal}`;

    return q.trim();
  });
}

/** Arbitrary: random string (for no-crash testing). */
export function arbitraryAnyString(): fc.Arbitrary<string> {
  return fc.string();
}

/** Arbitrary: slightly malformed valid query (for error path testing). */
export function arbitraryMalformedQuery(): fc.Arbitrary<string> {
  return fc.oneof(
    // Missing FROM
    fc.record({ func: functions, metric: metricNames }).map((r) =>
      `SELECT ${r.func}(${r.metric})`
    ),
    // Invalid function
    fc.record({ badFunc: fc.string({ minLength: 3, maxLength: 6 }).map((s) =>
        s.replace(/[^A-Z]/g, 'X')
      ), metric: metricNames, ns: namespaces }).map((r) =>
      `SELECT ${r.badFunc}(${r.metric}) FROM ${maybeQuote(r.ns)}`
    ),
    // Empty parentheses
    fc.constant('SELECT AVG() FROM "AWS/EC2"'),
    // Missing operator
    fc.constant('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId'),
    // LIMIT with string
    fc.constant('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT abc'),
  );
}

// ---- Helpers ----

function maybeQuote(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return name;
  }
  return `"${name}"`;
}

export { functions, metricNames, namespaces, dimensionKeys };
