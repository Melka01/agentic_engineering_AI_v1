import type { Paradigm } from '../../src/shared/domain.js';
import type { Session, SessionInputDraft } from '../../src/shared/session.js';

export interface Health {
  readonly status: string;
  readonly version: string;
  readonly engineVersion: string;
  readonly aiMode: 'anthropic' | 'offline' | 'custom';
  readonly providers: readonly string[];
  readonly circuits: Readonly<Record<string, string>>;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export interface ApiClient {
  health(): Promise<Health>;
  createSession(input: SessionInputDraft): Promise<Session>;
  switchParadigm(sessionId: string, paradigm: Paradigm): Promise<Session>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createApiClient(baseUrl = '', fetchImpl: FetchLike = (input, init) => fetch(input, init)): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch {
      throw new ApiError(0, 'The server could not be reached. Check that the API is running.');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const details = (body ?? {}) as {
        message?: string;
        error?: string;
        issues?: { path: string; message: string }[];
      };
      const message =
        details.issues !== undefined && details.issues.length > 0
          ? details.issues.map((i) => `${i.path || 'input'}: ${i.message}`).join('; ')
          : (details.message ?? details.error ?? `Request failed (${response.status})`);
      throw new ApiError(response.status, message, details.issues ?? []);
    }
    return body as T;
  }

  return {
    health: () => request<Health>('/api/health'),
    createSession: (input) => request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify(input) }),
    switchParadigm: (sessionId, paradigm) =>
      request<Session>(`/api/sessions/${encodeURIComponent(sessionId)}/paradigm`, {
        method: 'PUT',
        body: JSON.stringify({ paradigm }),
      }),
  };
}
