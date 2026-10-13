import { type KeyboardEvent, useState } from 'react';
import type { Paradigm } from '../../../src/shared/domain.js';
import { PARADIGM_DESCRIPTORS } from '../../../src/shared/paradigms.js';
import type { Session } from '../../../src/shared/session.js';
import {
  BlueprintPanel,
  DecisionsPanel,
  FindingsPanel,
  NfrPanel,
  RiskPanel,
  StoriesPanel,
  TracePanel,
} from './panels.js';

const TABS = ['stories', 'findings', 'nfrs', 'risks', 'blueprint', 'decisions', 'trace'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  stories: 'User stories',
  findings: 'Validation',
  nfrs: 'NFRs',
  risks: 'Risks',
  blueprint: 'Blueprint',
  decisions: 'Decisions',
  trace: 'Agent trace',
};

export interface SessionViewProps {
  readonly session: Session;
  readonly switching: boolean;
  readonly error: string | null;
  readonly onSwitch: (paradigm: Paradigm) => void;
  readonly onNew: () => void;
}

export function SessionView({ session, switching, error, onSwitch, onNew }: SessionViewProps) {
  const [tab, setTab] = useState<Tab>('stories');
  const current = PARADIGM_DESCRIPTORS[session.paradigm];
  const other: Paradigm = session.paradigm === 'mendix' ? 'outsystems' : 'mendix';
  const { summary } = session.validation;
  const degraded = session.agentTrace.some((t) => t.degraded);
  const offline = session.agentTrace.every((t) => t.servedBy === 'deterministic-fallback');

  const counts: Record<Tab, number | null> = {
    stories: session.stories.length,
    findings: session.validation.findings.length,
    nfrs: session.nfrs.length,
    risks: session.risks.length,
    blueprint: null,
    decisions: session.blueprint.decisions.length,
    trace: session.agentTrace.length,
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    if (next !== undefined) {
      setTab(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  };

  return (
    <div className={`session paradigm-${session.paradigm}`}>
      <section className="card session-header" aria-label="Session summary">
        <div>
          <p className="eyebrow">Requirements session</p>
          <h2>{session.projectName}</h2>
          <p className="row">
            <span className={`badge paradigm-badge paradigm-${session.paradigm}`} data-testid="active-paradigm">
              {current.name}
            </span>
            <span className="muted small">
              {session.validation.engine} v{session.validation.engineVersion}
            </span>
            {offline && <span className="badge">offline agents</span>}
            {degraded && !offline && <span className="badge sev-warning">AI degraded — fallback used</span>}
          </p>
        </div>
        <div className={`score ${summary.passed ? 'pass' : 'fail'}`}>
          <span className="visually-hidden">Compliance score</span>
          <span className="score-value">{summary.score}</span>
          <span className="score-label">{summary.passed ? 'compliant' : 'violations'}</span>
        </div>
        <dl className="kpis">
          <div>
            <dt>Errors</dt>
            <dd>{summary.errors}</dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>{summary.warnings}</dd>
          </div>
          <div>
            <dt>Info</dt>
            <dd>{summary.infos}</dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>{summary.rulesEvaluated}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <button type="button" className="primary" onClick={() => onSwitch(other)} disabled={switching}>
            {switching ? 'Re-synthesising…' : `Switch to ${PARADIGM_DESCRIPTORS[other].name}`}
          </button>
          <button type="button" className="secondary" onClick={onNew} disabled={switching}>
            New session
          </button>
        </div>
      </section>

      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div role="tablist" aria-label="Session results" className="tabs">
        {TABS.map((t, index) => (
          <button
            key={t}
            id={`tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => onTabKey(e, index)}
          >
            {TAB_LABEL[t]}
            {counts[t] !== null && <span className="count">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel">
        {tab === 'stories' && (
          <StoriesPanel stories={session.stories} compliance={session.validation.storyCompliance} />
        )}
        {tab === 'findings' && <FindingsPanel findings={session.validation.findings} />}
        {tab === 'nfrs' && <NfrPanel nfrs={session.nfrs} />}
        {tab === 'risks' && <RiskPanel risks={session.risks} />}
        {tab === 'blueprint' && <BlueprintPanel blueprint={session.blueprint} />}
        {tab === 'decisions' && <DecisionsPanel decisions={session.blueprint.decisions} />}
        {tab === 'trace' && <TracePanel traces={session.agentTrace} />}
      </div>
    </div>
  );
}
