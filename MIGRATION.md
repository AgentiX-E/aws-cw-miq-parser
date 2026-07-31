# Migration Guide: From Raw MIQ Queries to aws-cw-miq-parser

This guide helps teams migrate from hand-writing CloudWatch Metrics Insights queries (in Terraform, CloudFormation, AWS SDK, or Grafana) to using `@agentix-e/aws-cw-miq-parser` for static validation, linting, and transformation.

## Table of Contents

1. [Why Migrate?](#why-migrate)
2. [Terraform Migration](#terraform-migration)
3. [CloudFormation Migration](#cloudformation-migration)
4. [AWS SDK Migration](#aws-sdk-migration)
5. [Grafana Dashboard Migration](#grafana-dashboard-migration)
6. [CI/CD Integration](#cicd-integration)
7. [Common Pitfalls](#common-pitfalls)

## Why Migrate?

| Without aws-cw-miq-parser | With aws-cw-miq-parser |
|---|---|
| MIQ syntax errors discovered at runtime (AWS API call) | Syntax errors caught at build time (pre-deployment) |
| No way to validate queries in IaC templates | CI pipeline validates all MIQ queries before `terraform apply` |
| Manual query review for cost optimization | Automated cost estimation with per-clause impact analysis |
| Copy-paste query patterns across dashboards | Programmatic query transformation with AST visitor |
| No IDE support for MIQ | Autocomplete data for LSP/Monaco integration |

## Terraform Migration

### Before (raw MIQ in Terraform)

```hcl
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name = "high-cpu"
  metric_query {
    id          = "m1"
    expression  = "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE InstanceType = 'm5.large' GROUP BY InstanceId ORDER BY AVG() DESC LIMIT 10"
    return_data = true
  }
}
```

### After (validated MIQ in Terraform)

```hcl
# terraform main.tf — queries validated in CI
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name = "high-cpu"
  metric_query {
    id          = "m1"
    expression  = "SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE InstanceType = 'm5.large' GROUP BY InstanceId ORDER BY AVG() DESC LIMIT 10"
    return_data = true
  }
}
```

```typescript
// scripts/validate-tf-queries.ts — runs in CI before terraform apply
import { parse, lint } from '@agentix-e/aws-cw-miq-parser';
import { readFileSync } from 'node:fs';

function validateTerraformQueries(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const miqPattern = /expression\s*=\s*"([^"]+)"/g;
  let match, hasErrors = false;

  while ((match = miqPattern.exec(content)) !== null) {
    try {
      const ast = parse(match[1]!);
      const issues = lint(ast, {
        rules: {
          'require-schema': 'warn',
          'enforce-limit': 'error',
          'max-group-by': 'warn',
        },
      });
      if (issues.length > 0) {
        console.error(`Issues in query: ${match[1]!.slice(0, 60)}...`);
        for (const issue of issues) {
          console.error(`  [${issue.code}] ${issue.message}`);
        }
        hasErrors = true;
      }
    } catch (err: any) {
      console.error(`Parse error at line ${err.location?.start?.line}: ${err.message}`);
      hasErrors = true;
    }
  }
  return !hasErrors;
}

const result = validateTerraformQueries(process.argv[2]!);
process.exit(result ? 0 : 1);
```

```yaml
# .github/workflows/validate-queries.yml
- name: Validate MIQ queries in Terraform
  run: |
    npx tsx scripts/validate-tf-queries.ts terraform/main.tf
```

## CloudFormation Migration

```typescript
// scripts/validate-cfn-queries.ts
import { parse, validate } from '@agentix-e/aws-cw-miq-parser';
import { readFileSync } from 'node:fs';

function validateCloudFormationQueries(templatePath: string): boolean {
  const template = JSON.parse(readFileSync(templatePath, 'utf-8'));
  let hasErrors = false;

  for (const [name, resource] of Object.entries(template.Resources ?? {})) {
    const res = resource as any;
    if (res.Type !== 'AWS::CloudWatch::Alarm') continue;

    for (const mq of res.Properties?.Metrics ?? []) {
      if (!mq.Expression) continue;
      try {
        const ast = parse(mq.Expression);
        const result = validate(ast);
        if (!result.valid) {
          console.error(`Resource ${name}: validation failed`);
          for (const e of result.errors) {
            console.error(`  [${e.code}] ${e.message}`);
          }
          hasErrors = true;
        }
      } catch (err: any) {
        console.error(`Resource ${name}: parse error — ${err.message}`);
        hasErrors = true;
      }
    }
  }
  return !hasErrors;
}
```

## AWS SDK Migration

### Before (raw string, no validation)

```typescript
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const client = new CloudWatchClient({});
const query = "SELECT AVG(CPUUtilization) FROM \"AWS/EC2\""; // no validation!
await client.send(new GetMetricDataCommand({
  MetricDataQueries: [{ Id: 'q1', Expression: query }],
  StartTime: new Date(Date.now() - 3600000),
  EndTime: new Date(),
}));
```

### After (validated query, pre-validated cost estimate)

```typescript
import { parse, validate, estimateCost } from '@agentix-e/aws-cw-miq-parser';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

function buildMetricQuery(queryStr: string) {
  const ast = parse(queryStr);           // Throws ParseError if invalid syntax
  const result = validate(ast);           // Semantic checks (LIMIT range, reserved keywords)
  if (!result.valid) {
    throw new Error(`Query validation failed: ${result.errors[0]!.message}`);
  }
  const cost = estimateCost(ast);         // Check estimated cost before execution
  console.log(`Estimated cost: ${cost.estimatedCost.typical}`);

  return { Id: 'q1', Expression: queryStr };
}
```

## Grafana Dashboard Migration

Use the enhanced visitor to transform queries when migrating dashboards:

```typescript
import { parse, serialize, traverseWithPath } from '@agentix-e/aws-cw-miq-parser';

function migrateDashboard(dashboard: any): any {
  for (const panel of dashboard.panels ?? []) {
    for (const target of panel.targets ?? []) {
      if (!target.expression) continue;
      try {
        const ast = parse(target.expression);
        traverseWithPath(ast, {
          visitFromClause(path) {
            // Convert bare namespace to SCHEMA for better query specificity
            if (path.node.type === 'NamespaceFrom') {
              path.replaceWith({
                type: 'SchemaFrom' as const,
                namespace: path.node.namespace,
                dimensions: [],
                location: path.node.location,
              });
            }
          },
          visitLimitClause(path) {
            // Cap LIMIT at 100 for dashboard queries
            if (path.node.value > 100) {
              path.replaceWith({
                type: 'LimitClause' as const,
                value: 100,
                location: path.node.location,
              });
            }
          },
        });
        target.expression = serialize(ast);
      } catch {
        // Skip unparseable queries — they'll need manual review
        console.warn(`Skipping unparseable query: ${target.expression.slice(0, 60)}`);
      }
    }
  }
  return dashboard;
}
```

## CI/CD Integration

Recommended pipeline:

```yaml
# .github/workflows/miq-validation.yml
name: MIQ Query Validation

on:
  pull_request:
    paths:
      - '**/*.tf'         # Terraform
      - '**/*.json'       # CloudFormation
      - '**/*.miq'        # Raw query files
      - '**/*.ts'         # TypeScript with embedded queries

jobs:
  validate-queries:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm add @agentix-e/aws-cw-miq-parser

      # Validate raw .miq files
      - name: Validate .miq files
        run: |
          for f in $(find . -name '*.miq'); do
            echo "Validating $f"
            npx cw-miq validate "$f" || exit 1
          done

      # Validate Terraform queries
      - name: Validate Terraform queries
        run: npx tsx scripts/validate-tf-queries.ts terraform/

  cost-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm add @agentix-e/aws-cw-miq-parser

      - name: Check query costs
        run: |
          for f in $(find . -name '*.miq'); do
            echo "Cost estimate for $f"
            cat "$f"
          done
```

## Common Pitfalls

### 1. Unquoted reserved keywords

```typescript
// ❌ Incorrect: LIMIT is a reserved keyword
parse('SELECT AVG(LIMIT) FROM "AWS/EC2"');
// ParseError: Expected metric name but found reserved keyword LIMIT

// ✅ Correct: quote the reserved keyword
parse('SELECT AVG("LIMIT") FROM "AWS/EC2"');
```

### 2. Mixing parse() and validate() concerns

```typescript
// ❌ Wrong approach: relying on parse() only
const ast = parse(query); // Only checks syntax
// ast may be structurally valid but semantically invalid

// ✅ Correct approach: parse() + validate()
const ast = parse(query);
const result = validate(ast);
if (!result.valid) {
  console.error('Semantic errors:', result.errors);
}
```

### 3. Assuming OR is supported by AWS

```typescript
// ⚠️ The parser accepts OR, but AWS docs only document AND
parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE a = '1' OR b = '2'");
// Parser: OK (forward-compat)
// AWS API: May reject depending on engine version
```

### 4. Forgetting LIMIT on GROUP BY queries

```typescript
// Without LIMIT, up to 500 time series may be returned
// Linter warns about this:
const issues = lint(ast); // [{ code: 'LINT_ENFORCE_LIMIT', ... }]
```

### 5. SCHEMA with zero dimensions !== bare namespace

```typescript
// FROM SCHEMA("AWS/EC2") — only matches metrics with exactly zero dimensions
// FROM "AWS/EC2" — matches ALL metrics in the namespace regardless of dimensions
// These have different costs and different result sets.
```
