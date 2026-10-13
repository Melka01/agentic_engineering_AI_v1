import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../src/agents/logger.js';
import { loadConfig } from '../../src/server/config.js';
import { createServices } from '../../src/server/container.js';
import { SessionInputSchema } from '../../src/shared/session.js';
import { App } from '../../web/src/App.js';
import { type ApiClient, ApiError, createApiClient } from '../../web/src/api.js';

/** A real (offline) backend behind the ApiClient interface. */
function realApi(): ApiClient & { createSession: ReturnType<typeof vi.fn>; switchParadigm: ReturnType<typeof vi.fn> } {
  const { sessions } = createServices(loadConfig({ RE_AI_MODE: 'offline' }), silentLogger);
  return {
    health: async () => ({
      status: 'ok',
      version: '1.0.0',
      engineVersion: '1.0.0',
      aiMode: 'offline',
      providers: [],
      circuits: {},
    }),
    createSession: vi.fn(async (input) => sessions.create(SessionInputSchema.parse(input))),
    switchParadigm: vi.fn(async (id: string, paradigm) => sessions.switchParadigm(id, paradigm)),
  };
}

describe('App — paradigm-driven requirements session', () => {
  it('creates an OutSystems session from the selector, then switches to Mendix', async () => {
    const user = userEvent.setup();
    const api = realApi();
    render(<App api={api} />);

    expect(await screen.findByText('Deterministic agents (offline)')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'OutSystems' }));
    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await user.click(screen.getByRole('button', { name: 'Generate & validate' }));

    await waitFor(() => expect(screen.getByTestId('active-paradigm').textContent).toBe('OutSystems'));
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ paradigm: 'outsystems', projectName: 'Expense Portal' }),
    );
    expect(screen.getByText('outsystems-best-practice-engine v1.0.0')).toBeTruthy();

    // Stories tab lists generated stories with compliance status.
    expect(screen.getAllByRole('article').length).toBeGreaterThanOrEqual(4);

    // Blueprint tab renders the 3-layer canvas.
    await user.click(screen.getByRole('tab', { name: /Blueprint/ }));
    const canvas = screen.getByLabelText('OutSystems Architecture Canvas');
    expect(within(canvas).getByLabelText('End-User layer')).toBeTruthy();
    expect(within(canvas).getByLabelText('Core layer').textContent).toContain('ExpensePortal_CS');
    expect(within(canvas).getByLabelText('Foundation layer').textContent).toContain('Sap_IS');

    // Switch paradigm on the live session.
    await user.click(screen.getByRole('button', { name: 'Switch to Mendix' }));
    await waitFor(() => expect(screen.getByTestId('active-paradigm').textContent).toBe('Mendix'));
    expect(api.switchParadigm).toHaveBeenCalledWith(expect.any(String), 'mendix');
    expect(screen.getByText('mendix-best-practice-engine v1.0.0')).toBeTruthy();
    expect(screen.getByLabelText('Mendix module ExpensePortal').textContent).toContain('ExpenseClaimSearchVM');

    // Validation and risk tabs render engine output.
    await user.click(screen.getByRole('tab', { name: /Validation/ }));
    expect(screen.getByLabelText('Filter by severity')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Risks/ }));
    expect(screen.getByLabelText('Risk heat map')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Agent trace/ }));
    expect(screen.getAllByText('deterministic-fallback').length).toBeGreaterThan(0);
  });

  it('shows API errors to the user', async () => {
    const user = userEvent.setup();
    const api: ApiClient = {
      health: async () => {
        throw new ApiError(0, 'down');
      },
      createSession: async () => {
        throw new ApiError(400, 'requirementsText: must contain at least 20 characters');
      },
      switchParadigm: async () => {
        throw new Error('unused');
      },
    };
    render(<App api={api} />);
    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await user.click(screen.getByRole('button', { name: 'Generate & validate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('at least 20 characters');
    expect(screen.getByText('API offline')).toBeTruthy();
  });
});

describe('ApiClient', () => {
  it('maps validation issues and network failures to ApiError', async () => {
    const failing = createApiClient(
      '',
      async () =>
        new Response(
          JSON.stringify({ error: 'validation_error', issues: [{ path: 'paradigm', message: 'Invalid option' }] }),
          { status: 400 },
        ),
    );
    await expect(
      failing.createSession({ projectName: 'x', paradigm: 'mendix', requirementsText: 'y' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'paradigm: Invalid option',
    });
    const unreachable = createApiClient('', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(unreachable.health()).rejects.toMatchObject({ status: 0 });
  });

  it('sends the paradigm switch as PUT with a JSON body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createApiClient('http://api', async (url, init) => {
      calls.push(init === undefined ? { url } : { url, init });
      return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
    });
    await client.switchParadigm('abc', 'outsystems');
    expect(calls[0]?.url).toBe('http://api/api/sessions/abc/paradigm');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.body).toBe('{"paradigm":"outsystems"}');
  });
});
