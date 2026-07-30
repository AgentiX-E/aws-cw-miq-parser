#!/usr/bin/env node
// CLI tool for the CloudWatch Metrics Insights Query Parser.
//
// Usage:
//   cw-miq parse <file>        Parse a .miq file and output JSON AST
//   cw-miq validate <file>     Validate a query file
//   cw-miq lint <file>         Lint a query file
//   cw-miq serialize <file>    Serialize JSON AST back to query string
//   cw-miq format <file>       Pretty-print a query

import { cac } from 'cac';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, serialize, validate, lint, formatError } from '../source/index.js';

const cli = cac('cw-miq');

interface GlobalOptions {
  color?: boolean;
}

// ---- Parse command ----

cli
  .command('parse <file>', 'Parse a Metrics Insights query file and output JSON AST')
  .option('-c, --compact', 'Output compact JSON (no indentation)')
  .action(async (file: string, options: { compact?: boolean }) => {
    try {
      const query = readFileSync(resolve(file), 'utf-8').trim();
      const result = parse(query);
      const json = JSON.stringify(result, null, options.compact ? 0 : 2);
      console.log(json);
      process.exit(0);
    } catch (err: any) {
      handleError(file, err);
    }
  });

// ---- Validate command ----

cli
  .command('validate <file>', 'Validate a Metrics Insights query syntax and semantics')
  .action(async (file: string) => {
    try {
      const query = readFileSync(resolve(file), 'utf-8').trim();
      const result = parse(query);
      const validation = validate(result);

      if (!validation.valid) {
        console.error('❌ Validation failed:');
        for (const e of validation.errors) {
          console.error(`  [${e.code}] ${e.message}`);
        }
        process.exit(1);
      }

      if (validation.warnings.length > 0) {
        console.log('⚠️  Query is valid with warnings:');
        for (const w of validation.warnings) {
          console.log(`  [${w.code}] ${w.message}`);
        }
      } else {
        console.log('✅ Query is valid.');
      }

      process.exit(0);
    } catch (err: any) {
      handleError(file, err);
    }
  });

// ---- Lint command ----

cli
  .command('lint <file>', 'Lint a Metrics Insights query for best practices')
  .action(async (file: string) => {
    try {
      const query = readFileSync(resolve(file), 'utf-8').trim();
      const result = parse(query);
      const messages = lint(result);

      if (messages.length === 0) {
        console.log('✅ No lint issues found.');
        process.exit(0);
      }

      for (const msg of messages) {
        const icon = msg.severity === 'error' ? '❌' : '⚠️';
        console.log(`${icon} [${msg.code}] ${msg.message}`);
      }
      process.exit(0);
    } catch (err: any) {
      handleError(file, err);
    }
  });

// ---- Serialize command ----

cli
  .command('serialize <file>', 'Parse a query and serialize it back to SQL string')
  .option('-p, --pretty', 'Pretty-print the output')
  .action(async (file: string, options: { pretty?: boolean }) => {
    try {
      const query = readFileSync(resolve(file), 'utf-8').trim();
      const result = parse(query);
      const output = serialize(result, { pretty: options.pretty ?? false });
      console.log(output);
      process.exit(0);
    } catch (err: any) {
      handleError(file, err);
    }
  });

// ---- Format command ----

cli
  .command('format <file>', 'Pretty-print a Metrics Insights query')
  .action(async (file: string) => {
    try {
      const query = readFileSync(resolve(file), 'utf-8').trim();
      const result = parse(query);
      const output = serialize(result, { pretty: true, uppercase: true });
      console.log(output);
      process.exit(0);
    } catch (err: any) {
      handleError(file, err);
    }
  });

// ---- Error handling ----

function handleError(filename: string, err: any): never {
  if (err && err.location) {
    // ParseError with source location
    const source = (() => {
      try { return readFileSync(resolve(filename), 'utf-8'); } catch { return ''; }
    })();
    const formatted = formatError(source, err);
    console.error(formatted);
  } else {
    console.error(`Error: ${err.message ?? err}`);
  }
  process.exit(1);
}

// ---- CLI metadata ----

cli.help();
cli.version('0.5.0');

cli.parse();
