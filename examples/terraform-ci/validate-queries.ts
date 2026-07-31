#!/usr/bin/env npx tsx
// CI validation script: parse, validate, and lint all CloudWatch Metrics Insights
// queries embedded in Terraform (.tf) files.
//
// Usage:
//   npx tsx validate-queries.ts <path-to-terraform-directory>
//
// Exit codes:
//   0 — All queries valid (no errors, warnings OK)
//   1 — One or more queries have errors (blocks deployment)

import { parse, validate, lint, estimateCost } from '@agentix-e/aws-cw-miq-parser';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIQ_PATTERN = /expression\s*=\s*<<-?EOT\s*\n([\s\S]*?)\n\s*EOT/g;
const MIQ_INLINE = /expression\s*=\s*"([^"]+)"/g;

interface QueryIssue {
  file: string;
  query: string;
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

function collectTfFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== '.terraform' && entry !== 'node_modules') {
      files.push(...collectTfFiles(fullPath));
    } else if (stat.isFile() && extname(entry) === '.tf') {
      files.push(fullPath);
    }
  }

  return files;
}

function extractQueries(content: string): Array<{ query: string; line: number }> {
  const queries: Array<{ query: string; line: number }> = [];

  // HEREDOC expressions
  let match: RegExpExecArray | null;
  while ((match = MIQ_PATTERN.exec(content)) !== null) {
    const query = match[1]!.trim();
    if (query) {
      const line = content.slice(0, match.index).split('\n').length;
      queries.push({ query, line });
    }
  }

  // Inline expressions
  MIQ_INLINE.lastIndex = 0;
  while ((match = MIQ_INLINE.exec(content)) !== null) {
    const query = match[1]!.trim();
    if (query) {
      const line = content.slice(0, match.index).split('\n').length;
      queries.push({ query, line });
    }
  }

  return queries;
}

function validateFile(filePath: string): QueryIssue[] {
  const issues: QueryIssue[] = [];
  let content: string;

  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`Cannot read ${filePath} — skipping`);
    return issues;
  }

  const queries = extractQueries(content);
  if (queries.length === 0) return issues;

  for (const { query, line } of queries) {
    // Parse check (blocks on failure)
    try {
      const ast = parse(query);
      const validation = validate(ast);

      // Semantic errors
      for (const err of validation.errors) {
        issues.push({
          file: filePath,
          query: query.slice(0, 80),
          severity: 'error',
          message: err.message,
          code: err.code,
        });
      }

      // Semantic warnings
      for (const w of validation.warnings) {
        issues.push({
          file: filePath,
          query: query.slice(0, 80),
          severity: 'warning',
          message: w.message,
          code: w.code,
        });
      }

      // Lint
      const lintIssues = lint(ast, {
        rules: {
          'enforce-limit': 'error',
          'require-schema': 'warn',
          'max-group-by': 'warn',
          'where-without-schema': 'warn',
          'max-limit': 'warn',
          'count-without-order': 'warn',
        },
      });

      for (const li of lintIssues) {
        issues.push({
          file: filePath,
          query: query.slice(0, 80),
          severity: li.severity === 'error' ? 'error' : 'warning',
          message: li.message,
          code: li.code,
        });
      }

      // Cost estimate (informational)
      const cost = estimateCost(ast);
      console.log(
        `  [cost] ${filePath}:${line} — ${cost.estimatedCost.typical} (${cost.metricCount.typical.toLocaleString()} metrics)`
      );

    } catch (err: any) {
      issues.push({
        file: filePath,
        query: query.slice(0, 80),
        severity: 'error',
        message: `Parse error at line ${err.location?.start?.line ?? line}: ${err.message}`,
        code: err.code ?? 'PARSE_ERROR',
      });
    }
  }

  return issues;
}

// ---- Main ----

const targetDir = process.argv[2] ?? '.';
if (!existsSync(targetDir)) {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(1);
}

console.log(`\n🔍 Validating MIQ queries in ${targetDir}...\n`);

const tfFiles = collectTfFiles(targetDir);
if (tfFiles.length === 0) {
  console.log('No .tf files found.');
  process.exit(0);
}

const allIssues: QueryIssue[] = [];
for (const file of tfFiles) {
  const issues = validateFile(file);
  allIssues.push(...issues);
}

// Report
const errors = allIssues.filter((i) => i.severity === 'error');
const warnings = allIssues.filter((i) => i.severity === 'warning');

console.log(`\n${'─'.repeat(60)}`);
console.log(`Files scanned: ${tfFiles.length}`);
console.log(`Errors:   ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`${'─'.repeat(60)}`);

if (warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  for (const w of warnings) {
    console.log(`  [${w.code}] ${w.file}: ${w.message}`);
  }
}

if (errors.length > 0) {
  console.log('\n❌ Errors:');
  for (const e of errors) {
    console.log(`  [${e.code}] ${e.file}: ${e.message}`);
  }
  console.log(`\n❌ Validation FAILED — ${errors.length} error(s) found.`);
  process.exit(1);
}

console.log('\n✅ All MIQ queries are valid.\n');
process.exit(0);
