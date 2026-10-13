/**
 * Session lifecycle: create (full pipeline), read, list and switch paradigm
 * (keeps the backlog, re-synthesises and re-validates for the new platform).
 */
import { randomUUID } from 'node:crypto';
import { createEngine, type EngineOptions } from '../engines/registry.js';
import type { ValidationInput } from '../engines/types.js';
import type { Paradigm, ValidationReport } from '../shared/domain.js';
import type { Session, SessionInput } from '../shared/session.js';
import type { RequirementsPipeline } from './pipeline.js';

export interface SessionSummary {
  readonly id: string;
  readonly projectName: string;
  readonly paradigm: Paradigm;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly score: number;
  readonly passed: boolean;
  readonly stories: number;
}

export interface SessionRepository {
  get(id: string): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
  list(): Promise<Session[]>;
}

/** Bounded in-memory repository (oldest sessions are evicted first). */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly capacity = 500) {}

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async save(session: Session): Promise<void> {
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
    while (this.sessions.size > this.capacity) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  async list(): Promise<Session[]> {
    return [...this.sessions.values()].reverse();
  }
}

export class SessionNotFoundError extends Error {
  override readonly name = 'SessionNotFoundError';
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} not found`);
  }
}

export interface SessionServiceOptions {
  readonly pipeline: RequirementsPipeline;
  readonly repository: SessionRepository;
  readonly engineOptions?: EngineOptions;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class SessionService {
  private readonly pipeline: RequirementsPipeline;
  private readonly repository: SessionRepository;
  private readonly engineOptions: EngineOptions;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: SessionServiceOptions) {
    this.pipeline = options.pipeline;
    this.repository = options.repository;
    this.engineOptions = options.engineOptions ?? {};
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  async create(input: SessionInput, signal?: AbortSignal): Promise<Session> {
    const backlog = await this.pipeline.generateBacklog(input, signal);
    const design = await this.pipeline.synthesizeAndValidate(
      { paradigm: input.paradigm, projectName: input.projectName, stories: backlog.stories, nfrs: backlog.nfrs },
      signal,
    );
    const at = this.now().toISOString();
    const session: Session = {
      id: this.newId(),
      createdAt: at,
      updatedAt: at,
      projectName: input.projectName,
      paradigm: input.paradigm,
      input,
      stories: backlog.stories,
      nfrs: backlog.nfrs,
      blueprint: design.blueprint,
      validation: design.validation,
      risks: design.risks,
      agentTrace: [backlog.trace, ...design.traces],
      history: [{ at, type: 'created', paradigm: input.paradigm, detail: `Session created for ${input.paradigm}.` }],
    };
    await this.repository.save(session);
    return session;
  }

  async get(id: string): Promise<Session> {
    const session = await this.repository.get(id);
    if (session === undefined) throw new SessionNotFoundError(id);
    return session;
  }

  async list(): Promise<SessionSummary[]> {
    return (await this.repository.list()).map((s) => ({
      id: s.id,
      projectName: s.projectName,
      paradigm: s.paradigm,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      score: s.validation.summary.score,
      passed: s.validation.summary.passed,
      stories: s.stories.length,
    }));
  }

  /** Switches the session to another paradigm; idempotent when the paradigm is unchanged. */
  async switchParadigm(id: string, paradigm: Paradigm, signal?: AbortSignal): Promise<Session> {
    const session = await this.get(id);
    if (session.paradigm === paradigm) return session;
    const design = await this.pipeline.synthesizeAndValidate(
      { paradigm, projectName: session.projectName, stories: session.stories, nfrs: session.nfrs },
      signal,
    );
    const at = this.now().toISOString();
    const storyTrace = session.agentTrace.find((t) => t.agent === 'story-generator');
    const updated: Session = {
      ...session,
      paradigm,
      input: { ...session.input, paradigm },
      updatedAt: at,
      blueprint: design.blueprint,
      validation: design.validation,
      risks: design.risks,
      agentTrace: [...(storyTrace === undefined ? [] : [storyTrace]), ...design.traces],
      history: [
        ...session.history,
        {
          at,
          type: 'paradigm-switched',
          paradigm,
          detail: `Switched from ${session.paradigm} to ${paradigm}; blueprint re-synthesised and re-validated.`,
        },
      ],
    };
    await this.repository.save(updated);
    return updated;
  }

  /** Stateless validation of caller-supplied artefacts (e.g. from CI). */
  validate(paradigm: Paradigm, input: ValidationInput): ValidationReport {
    return createEngine(paradigm, this.engineOptions).validate(input);
  }
}
