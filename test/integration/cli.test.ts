// Integration tests: CLI commands for parse, validate, lint, serialize, format.
// Tests the CLI end-to-end by invoking it programmatically.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = 'node --import tsx cli/index.ts';
const TMP = tmpdir();

function createTempFile(content: string): string {
  const path = join(TMP, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.miq`);
  writeFileSync(path, content + '\n', 'utf-8');
  return path;
}

function runCli(cmd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 1,
    };
  }
}

describe('CLI — parse', () => {
  it('parses valid query to JSON', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const { stdout, code } = runCli(`${CLI} parse "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.type).toBe('MetricsInsightsQuery');
    expect(json.select.function).toBe('AVG');
    expect(json.from.namespace).toBe('AWS/EC2');
  });

  it('outputs compact JSON with --compact', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const { stdout, code } = runCli(`${CLI} parse "${file}" --compact`);
    unlinkSync(file);
    expect(code).toBe(0);
    // Compact JSON has no line breaks (except possibly in string values)
    const firstLine = stdout.split('\n')[0]!;
    expect(JSON.parse(firstLine).type).toBe('MetricsInsightsQuery');
  });

  it('exits with code 1 on invalid query', () => {
    const file = createTempFile('NOT A VALID QUERY');
    const { stderr, code } = runCli(`${CLI} parse "${file}"`);
    unlinkSync(file);
    expect(code).toBe(1);
    expect(stderr).toBeTruthy();
  });
});

describe('CLI — validate', () => {
  it('validates a correct query', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const { stdout, code } = runCli(`${CLI} validate "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('valid');
  });

  it('fails validation on LIMIT out of range', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 0');
    const { stderr, code } = runCli(`${CLI} validate "${file}"`);
    unlinkSync(file);
    expect(code).toBe(1);
    expect(stderr).toContain('SEM_LIMIT_OUT_OF_RANGE');
  });

  it('shows valid when query is correct with optional clauses', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) GROUP BY InstanceId LIMIT 10');
    const { stdout, code } = runCli(`${CLI} validate "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('valid');
  });
});

describe('CLI — lint', () => {
  it('lints a clean query', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) LIMIT 10');
    const { stdout, code } = runCli(`${CLI} lint "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('No lint issues');
  });

  it('reports lint warnings', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId');
    const { stdout, code } = runCli(`${CLI} lint "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('LINT_ENFORCE_LIMIT');
  });
});

describe('CLI — serialize', () => {
  it('serializes a query back to SQL', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const { stdout, code } = runCli(`${CLI} serialize "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('SELECT AVG');
    expect(stdout).toContain('FROM');
  });

  it('pretty-prints with --pretty', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM "AWS/EC2" WHERE InstanceId = \'i-123\'');
    const { stdout, code } = runCli(`${CLI} serialize "${file}" --pretty`);
    unlinkSync(file);
    expect(code).toBe(0);
    // Pretty output should have multiple lines
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CLI — format', () => {
  it('pretty-prints a query', () => {
    const file = createTempFile('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) WHERE InstanceId = \'i-123\'');
    const { stdout, code } = runCli(`${CLI} format "${file}"`);
    unlinkSync(file);
    expect(code).toBe(0);
    expect(stdout).toContain('SELECT');
    expect(stdout).toContain('FROM');
    // Formatted output should be multi-line
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});
