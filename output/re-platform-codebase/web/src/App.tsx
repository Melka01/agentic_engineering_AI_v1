import { useEffect, useMemo, useState } from 'react';
import type { Paradigm } from '../../src/shared/domain.js';
import type { Session, SessionInputDraft } from '../../src/shared/session.js';
import { type ApiClient, createApiClient, type Health } from './api.js';
import { SessionForm } from './components/SessionForm.js';
import { SessionView } from './components/SessionView.js';

export interface AppProps {
  readonly api?: ApiClient;
}

export function App({ api }: AppProps) {
  const client = useMemo(() => api ?? createApiClient(), [api]);
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .health()
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const run = async (task: () => Promise<Session>) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await task());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  const create = (input: SessionInputDraft) => void run(() => client.createSession(input));
  const switchTo = (paradigm: Paradigm) => {
    if (session !== null) void run(() => client.switchParadigm(session.id, paradigm));
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>RE Studio</h1>
          <p className="muted">
            AI-agent requirements engineering with strict Mendix &amp; OutSystems best-practice engines
          </p>
        </div>
        <span className="badge" data-testid="ai-mode">
          {health === null
            ? 'API offline'
            : health.aiMode === 'offline'
              ? 'Deterministic agents (offline)'
              : `Claude agents · ${health.providers.length} provider(s)`}
        </span>
      </header>
      <main>
        {session === null ? (
          <SessionForm busy={busy} error={error} onSubmit={create} />
        ) : (
          <SessionView
            session={session}
            switching={busy}
            error={error}
            onSwitch={switchTo}
            onNew={() => {
              setSession(null);
              setError(null);
            }}
          />
        )}
      </main>
    </div>
  );
}
