import { describe, expect, it } from 'vitest';
import { PARADIGM_LIST } from '../../src/shared/paradigms.js';
import { SessionInputSchema } from '../../src/shared/session.js';

describe('shared schemas', () => {
  it('accepts a valid session input and defaults domainContext', () => {
    const parsed = SessionInputSchema.parse({
      projectName: 'Expense Portal',
      paradigm: 'mendix',
      requirementsText: 'Employees submit expense claims that managers approve.',
    });
    expect(parsed.domainContext).toBe('');
  });

  it('rejects an unknown paradigm', () => {
    const result = SessionInputSchema.safeParse({
      projectName: 'X',
      paradigm: 'powerapps',
      requirementsText: 'Employees submit expense claims that managers approve.',
    });
    expect(result.success).toBe(false);
  });

  it('describes exactly two paradigms', () => {
    expect(PARADIGM_LIST.map((p) => p.id)).toEqual(['mendix', 'outsystems']);
  });
});
