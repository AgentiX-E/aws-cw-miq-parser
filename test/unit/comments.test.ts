// Unit tests: comment preservation — capture and round-trip.

import { describe, it, expect } from 'vitest';
import { parse } from '../../source/parser.js';
import { serialize } from '../../source/serializer.js';

describe('comment preservation', () => {
  it('captures leading line comment', () => {
    const result = parse('-- Top EC2 metrics\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.leadingComments).toBeDefined();
    expect(result.leadingComments!.length).toBeGreaterThanOrEqual(1);
    expect(result.leadingComments![0]!.text).toContain('Top EC2 metrics');
    expect(result.leadingComments![0]!.type).toBe('LineComment');
  });

  it('captures leading block comment', () => {
    const result = parse('/* Query: get CPU average */\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.leadingComments).toBeDefined();
    expect(result.leadingComments![0]!.type).toBe('BlockComment');
    expect(result.leadingComments![0]!.text).toContain('Query: get CPU average');
  });

  it('captures inline comment before query', () => {
    const result = parse('-- inline\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.leadingComments).toBeDefined();
  });

  it('captures multiple leading comments', () => {
    const result = parse('-- First\n-- Second\n/* third */\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.leadingComments).toBeDefined();
    expect(result.leadingComments!.length).toBeGreaterThanOrEqual(2);
  });

  it('no comments when none present', () => {
    const result = parse('SELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    expect(result.leadingComments).toBeUndefined();
    expect(result.trailingComments).toBeUndefined();
  });

  it('serializer preserves leading comments', () => {
    const result = parse('-- Top metrics\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const output = serialize(result);
    expect(output).toContain('-- Top metrics');
    expect(output).toContain('SELECT AVG');
  });

  it('comment round-trips through parse→serialize', () => {
    const input = '-- Leading\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"';
    const first = parse(input);
    const serialized = serialize(first);

    // Serialized output should contain the comment
    expect(serialized).toContain('-- Leading');

    // Re-parsing the serialized output should also capture the comment
    const second = parse(serialized);
    expect(second.leadingComments).toBeDefined();
  });

  it('comments have source locations', () => {
    const result = parse('-- Test comment\nSELECT AVG(CPUUtilization) FROM "AWS/EC2"');
    const comment = result.leadingComments![0]!;
    expect(comment.location).toBeDefined();
    expect(comment.location.start.line).toBeGreaterThanOrEqual(1);
    expect(comment.location.start.column).toBeGreaterThanOrEqual(1);
  });
});
