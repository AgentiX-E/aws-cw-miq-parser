// Benchmark regression detection script.
//
// Compares the current benchmark run against a stored baseline (JSON file).
// Flags throughput regressions ≥10% and reports improvements.
//
// Usage in CI:
//   node --import tsx scripts/benchmark-regression.mjs
//
// Baseline file: bench/baseline.json (committed to repo as performance contract)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const benchDir = join(rootDir, 'bench');
const baselinePath = join(benchDir, 'baseline.json');
const currentPath = join(benchDir, 'current.json');
const reportPath = join(benchDir, 'regression-report.md');

interface BenchEntry {
  name: string;
  opsPerSec: number;
  avgMs: number;
}

interface BaselineFile {
  timestamp: string;
  nodeVersion: string;
  entries: BenchEntry[];
}

function isCI(): boolean {
  return process.env['CI'] === 'true';
}

function runBenchmarks(): BenchEntry[] {
  console.log('[bench-regression] Running benchmarks...');

  const output = execSync('npx vitest bench --run', {
    cwd: rootDir,
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  const entries: BenchEntry[] = [];

  for (const line of lines) {
    // vitest bench output format:
    //   · name               hz        min      max      mean     p75      p99      p995     p999     rme      samples
    //   · simple query (41 chars)  7,371,193.96  0.0001  0.5051  0.0001  0.0002  0.0003  0.0005  0.0020  ±0.33%  3685597
    const match = line.match(
      /^\s*·\s+(.+?)\s+([\d,.]+)\s+[\d.]+\s+[\d.]+\s+[\d.]+/
    );
    if (match && !match[1]!.includes('name')) {
      entries.push({
        name: match[1]!.trim(),
        opsPerSec: Math.round(parseFloat(match[2]!.replace(/,/g, ''))),
        avgMs: 0, // Will be computed from hz
      });
    }
  }

  // Compute avgMs from opsPerSec
  for (const e of entries) {
    e.avgMs = Math.round((1000 / e.opsPerSec) * 10000) / 10000;
  }

  console.log(`[bench-regression] Found ${entries.length} benchmarks`);
  return entries;
}

function loadBaseline(): BaselineFile | null {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCurrent(entries: BenchEntry[]): void {
  mkdirSync(benchDir, { recursive: true });
  const baseline: BaselineFile = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    entries,
  };
  writeFileSync(currentPath, JSON.stringify(baseline, null, 2), 'utf-8');
  console.log(`[bench-regression] Saved current benchmark to ${currentPath}`);
}

function compareAndReport(current: BenchEntry[], baseline: BaselineFile): boolean {
  const reportLines: string[] = [
    '# Benchmark Regression Report',
    '',
    `**Current run**: ${new Date().toISOString()}`,
    `**Baseline**: ${baseline.timestamp} (Node ${baseline.nodeVersion})`,
    `**Current Node**: ${process.version}`,
    '',
    '| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ% | Status |',
    '|-----------|-----------------|----------------|-----|--------|',
  ];

  let hasRegression = false;
  let hasImprovement = false;

  for (const entry of current) {
    const baselineEntry = baseline.entries.find((b) => b.name === entry.name);
    if (!baselineEntry) {
      reportLines.push(`| ${entry.name} | — | ${entry.opsPerSec.toLocaleString()} | new | 🆕 |`);
      continue;
    }

    const delta = ((entry.opsPerSec - baselineEntry.opsPerSec) / baselineEntry.opsPerSec * 100);
    const deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
    let status = '✅';

    if (delta < -10) {
      status = '🔴 REGRESSION';
      hasRegression = true;
    } else if (delta < -5) {
      status = '🟡 WARNING';
    } else if (delta > 10) {
      status = '🟢 IMPROVEMENT';
      hasImprovement = true;
    }

    reportLines.push(
      `| ${entry.name} | ${baselineEntry.opsPerSec.toLocaleString()} | ${entry.opsPerSec.toLocaleString()} | ${deltaStr} | ${status} |`
    );
  }

  // Detect removed benchmarks
  for (const bl of baseline.entries) {
    if (!current.find((c) => c.name === bl.name)) {
      reportLines.push(`| ${bl.name} | ${bl.opsPerSec.toLocaleString()} | — | removed | ⚠️ |`);
    }
  }

  reportLines.push('');
  if (hasRegression) {
    reportLines.push('## ⚠️ Performance Regression Detected');
    reportLines.push('');
    reportLines.push('One or more benchmarks show a ≥10% throughput decrease compared to baseline.');
    reportLines.push('Please investigate the cause before merging.');
  } else if (hasImprovement) {
    reportLines.push('## 🎉 Performance Improvement');
    reportLines.push('');
    reportLines.push('One or more benchmarks show a ≥10% throughput increase. Consider updating the baseline.');
  } else {
    reportLines.push('## ✅ No Significant Changes');
    reportLines.push('');
    reportLines.push('All benchmarks are within ±10% of baseline.');
  }

  reportLines.push('');
  reportLines.push(`*Generated by benchmark-regression.mjs on ${new Date().toISOString()}*`);
  reportLines.push('');

  const report = reportLines.join('\n');
  writeFileSync(reportPath, report, 'utf-8');
  console.log(`[bench-regression] Report written to ${reportPath}`);

  return !hasRegression;
}

// ---- Main ----

async function main(): Promise<void> {
  console.log('[bench-regression] Starting benchmark regression check...\n');

  const current = runBenchmarks();

  if (current.length === 0) {
    console.log('[bench-regression] No benchmarks found — skipping regression check');
    process.exit(0);
  }

  saveCurrent(current);

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('[bench-regression] No baseline found — saving current as baseline');
    writeFileSync(baselinePath, JSON.stringify({
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      entries: current,
    }, null, 2), 'utf-8');
    // Don't fail on first run — baseline is being established
    process.exit(0);
  }

  const passed = compareAndReport(current, baseline);

  if (isCI()) {
    // In CI, emit GitHub step summary
    const reportContent = readFileSync(reportPath, 'utf-8');
    const githubSummary = process.env['GITHUB_STEP_SUMMARY'];
    if (githubSummary) {
      writeFileSync(githubSummary, reportContent, 'utf-8');
    }
  }

  if (!passed) {
    console.error('\n[bench-regression] ❌ Performance regression detected!');
    console.error('[bench-regression] See bench/regression-report.md for details.');
    process.exit(1);
  }

  console.log('\n[bench-regression] ✅ No regression detected');
}

main().catch((err) => {
  console.error('[bench-regression] Fatal error:', err);
  process.exit(1);
});
