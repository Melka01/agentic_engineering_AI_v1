import { describe, expect, it } from 'vitest';
import { createInBrowserApiClient } from '../../web/src/browser-api.js';
import { EXAMPLE_REQUIREMENTS } from '../../web/src/components/SessionForm.js';

describe('in-browser API client (standalone demo)', () => {
  it('runs the full pipeline and paradigm switch without a server', async () => {
    const api = createInBrowserApiClient();
    expect((await api.health()).aiMode).toBe('offline');

    const session = await api.createSession({
      projectName: 'Expense Portal',
      paradigm: 'outsystems',
      requirementsText: EXAMPLE_REQUIREMENTS,
    });
    expect(session.validation.engine).toBe('outsystems-best-practice-engine');
    expect(session.blueprint.paradigm).toBe('outsystems');
    expect(session.stories.length).toBeGreaterThan(3);

    const switched = await api.switchParadigm(session.id, 'mendix');
    expect(switched.validation.engine).toBe('mendix-best-practice-engine');
    expect(switched.stories).toEqual(session.stories);
  });

  it('reports invalid input and unknown sessions like the HTTP API', async () => {
    const api = createInBrowserApiClient();
    await expect(
      api.createSession({ projectName: '', paradigm: 'mendix', requirementsText: 'short' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(api.switchParadigm('missing', 'mendix')).rejects.toMatchObject({ status: 404 });
  });
});
