// Unit tests: semantic validator — cross-clause checks, reserved keywords, ranges.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { validate } from '../../source/validator.js';
import { ErrorCodes } from '../../source/errors.js';

describe('validate — LIMIT range', () => {
  it('rejects LIMIT 0', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 0');
    const result = validate(q);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.code).toBe(ErrorCodes.SEM_LIMIT_OUT_OF_RANGE);
  });

  it('rejects LIMIT 501', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 501');
    const result = validate(q);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.code).toBe(ErrorCodes.SEM_LIMIT_OUT_OF_RANGE);
  });

  it('accepts LIMIT 1', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 1');
    const result = validate(q);
    expect(result.valid).toBe(true);
  });

  it('accepts LIMIT 500', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" LIMIT 500');
    const result = validate(q);
    expect(result.valid).toBe(true);
  });
});

describe('validate — SELECT/ORDER BY function consistency', () => {
  it('warns when SELECT and ORDER BY functions differ', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY MAX()');
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_FUNCTION_MISMATCH);
    expect(warning).toBeDefined();
  });

  it('no warning when functions match', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" ORDER BY AVG()');
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_FUNCTION_MISMATCH);
    expect(warning).toBeUndefined();
  });
});

describe('validate — reserved keywords', () => {
  it('flags metric name that is a reserved keyword', () => {
    const q = parse('SELECT AVG(LIMIT) FROM "AWS/EC2"');
    const result = validate(q);
    const keywordError = result.errors.find((e) => e.code === ErrorCodes.SEM_RESERVED_KEYWORD);
    expect(keywordError).toBeDefined();
    expect(keywordError!.message).toContain('LIMIT');
  });

  it('flags namespace that is a reserved keyword', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM TYPE');
    const result = validate(q);
    const keywordError = result.errors.find((e) => e.code === ErrorCodes.SEM_RESERVED_KEYWORD);
    expect(keywordError).toBeDefined();
  });

  it('does not flag non-reserved identifiers', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const result = validate(q);
    const keywordErrors = result.errors.filter((e) => e.code === ErrorCodes.SEM_RESERVED_KEYWORD);
    expect(keywordErrors).toHaveLength(0);
  });
});

describe('validate — GROUP BY duplicates', () => {
  it('warns on duplicate GROUP BY keys', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId, InstanceId');
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_DUPLICATE_GROUP_BY);
    expect(warning).toBeDefined();
  });

  it('no warning on distinct GROUP BY keys', () => {
    const q = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2" GROUP BY InstanceId, InstanceType');
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_DUPLICATE_GROUP_BY);
    expect(warning).toBeUndefined();
  });
});

describe('validate — WHERE key in SCHEMA dimensions', () => {
  it('warns when WHERE key is not in SCHEMA dimensions', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE InstanceType = 't2.micro'");
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_WHERE_KEY_NOT_IN_SCHEMA);
    expect(warning).toBeDefined();
  });

  it('no warning when WHERE key is in SCHEMA dimensions', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId, InstanceType) WHERE InstanceType = 't2.micro'");
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_WHERE_KEY_NOT_IN_SCHEMA);
    expect(warning).toBeUndefined();
  });

  it('no warning for tag keys (not dimensions)', () => {
    const q = parse("SELECT AVG(CPUUtilization) FROM SCHEMA(\"AWS/EC2\", InstanceId) WHERE tag.env = 'prod'");
    const result = validate(q);
    const warning = result.warnings.find((w) => w.code === ErrorCodes.SEM_WHERE_KEY_NOT_IN_SCHEMA);
    expect(warning).toBeUndefined();
  });
});
