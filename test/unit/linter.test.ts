// Unit tests: query linter with configurable rules.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { lint, listRules } from '../../source/linter.js';

describe('linter — built-in rules', () => {
  it('listRules returns all available rules', () => {
    const rules = listRules();
    expect(rules.length).toBe(6);
    expect(rules[0]!.id).toBeDefined();
    expect(rules[0]!.description).toBeDefined();
  });

  it('enforce-limit rule warns on GROUP BY without LIMIT', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId');
    const messages = lint(q);
    const limitWarning = messages.find((m) => m.code === 'LINT_ENFORCE_LIMIT');
    expect(limitWarning).toBeDefined();
  });

  it('enforce-limit rule passes when LIMIT is present', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId LIMIT 10');
    const messages = lint(q);
    const limitWarning = messages.find((m) => m.code === 'LINT_ENFORCE_LIMIT');
    expect(limitWarning).toBeUndefined();
  });

  it('where-without-schema rule warns on WHERE with bare namespace', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-123'");
    const messages = lint(q);
    const wsWarning = messages.find((m) => m.code === 'LINT_WHERE_WITHOUT_SCHEMA');
    expect(wsWarning).toBeDefined();
  });

  it('max-group-by rule warns on excessive GROUP BY dimensions', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY a, b, c, d');
    const messages = lint(q);
    const mgbWarning = messages.find((m) => m.code === 'LINT_MAX_GROUP_BY');
    expect(mgbWarning).toBeDefined();
  });
});

describe('linter — rule configuration', () => {
  it('disabled rules produce no messages', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId');
    const messages = lint(q, { rules: { 'enforce-limit': 'off' } });
    const limitWarning = messages.find((m) => m.code === 'LINT_ENFORCE_LIMIT');
    expect(limitWarning).toBeUndefined();
  });

  it('rules can be elevated to error severity', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM \"AWS/EC2\" WHERE InstanceId = 'i-123'");
    const messages = lint(q, { rules: { 'where-without-schema': 'error' } });
    const wsWarning = messages.find((m) => m.code === 'LINT_WHERE_WITHOUT_SCHEMA');
    expect(wsWarning).toBeDefined();
    expect(wsWarning!.severity).toBe('error');
  });

  it('clean query produces no messages from enabled rules', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) LIMIT 10');
    const messages = lint(q);
    expect(messages.length).toBe(0);
  });

  it('require-schema rule warns on bare namespace', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const messages = lint(q, { rules: { 'require-schema': 'warn' } });
    const warning = messages.find((m) => m.code === 'LINT_REQUIRE_SCHEMA');
    expect(warning).toBeDefined();
  });

  it('max-limit rule warns on high LIMIT values', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 200');
    const messages = lint(q, { rules: { 'max-limit': 'warn' } });
    const warning = messages.find((m) => m.code === 'LINT_MAX_LIMIT');
    expect(warning).toBeDefined();
  });

  it('count-without-order rule warns on COUNT without ORDER BY', () => {
    const q = parse('SELECT COUNT(CallCount) FROM "AWS/Usage"');
    const messages = lint(q, { rules: { 'count-without-order': 'warn' } });
    const warning = messages.find((m) => m.code === 'LINT_COUNT_WITHOUT_ORDER');
    expect(warning).toBeDefined();
  });
});
