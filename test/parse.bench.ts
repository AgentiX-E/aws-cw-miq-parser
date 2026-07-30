// Performance benchmarks for the MIQ parser.
// Run with: vitest bench

import { bench, describe } from 'vitest';
import { parse } from '../source/parser.js';
import { serialize } from '../source/serializer.js';

const simpleQuery = 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"';
const mediumQuery = 'SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/EC2", InstanceId) WHERE tag.env = \'prod\' GROUP BY InstanceId ORDER BY AVG() DESC LIMIT 10';
const complexQuery = 'SELECT COUNT(CallCount) FROM SCHEMA("AWS/Usage", Class, Resource, Service, Type) WHERE Type = \'API\' GROUP BY Service, Resource ORDER BY COUNT() DESC LIMIT 20';

describe('parse performance', () => {
  bench('simple query (41 chars)', () => {
    parse(simpleQuery);
  });

  bench('medium query (140 chars)', () => {
    parse(mediumQuery);
  });

  bench('complex query (160 chars)', () => {
    parse(complexQuery);
  });

  bench('10 queries batch', () => {
    for (let i = 0; i < 10; i++) {
      parse(mediumQuery);
    }
  });

  bench('100 queries batch', () => {
    for (let i = 0; i < 100; i++) {
      parse(simpleQuery);
    }
  });
});

describe('serialize performance', () => {
  const parsedMedium = parse(mediumQuery);

  bench('medium query serialization', () => {
    serialize(parsedMedium);
  });
});

describe('round-trip performance', () => {
  bench('parse + serialize', () => {
    const p = parse(complexQuery);
    serialize(p);
  });

  bench('parse ×2 + serialize (with round-trip check)', () => {
    const p = parse(mediumQuery);
    const s = serialize(p);
    parse(s);
  });
});
