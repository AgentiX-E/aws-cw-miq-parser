// @generated — Do not edit directly.
// Type declarations for the Peggy-generated parser.

export interface PegSyntaxError extends Error {
  expected: { type: string; description: string }[];
  found: string | null;
  location: {
    start: { offset: number; line: number; column: number };
    end: { offset: number; line: number; column: number };
  };
}

export function parse<T = unknown>(input: string, options?: { startRule?: string }): T;
export const StartRules: string[];
export const SyntaxError: new (message: string, expected: unknown[], found: string | null, location: unknown) => PegSyntaxError;
