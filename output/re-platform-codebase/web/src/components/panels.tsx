import { useMemo, useState } from 'react';
import type {
  AgentRunTrace,
  Finding,
  NonFunctionalRequirement,
  Risk,
  Severity,
  StoryCompliance,
  UserStory,
} from '../../../src/shared/domain.js';
import type { MendixDesign } from '../../../src/shared/mendix.js';
import type { OutSystemsDesign } from '../../../src/shared/outsystems.js';
import { OS_LAYER_OF_KIND, type OsLayer } from '../../../src/shared/outsystems-layers.js';
import type { ArchitectureDecision, Blueprint } from '../../../src/shared/session.js';

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<StoryCompliance['status'], string> = {
  compliant: 'Compliant',
  'needs-attention': 'Needs attention',
  'non-compliant': 'Non-compliant',
};

export function StoriesPanel({
  stories,
  compliance,
}: {
  stories: readonly UserStory[];
  compliance: readonly StoryCompliance[];
}) {
  return (
    <div className="stack">
      {stories.map((s) => {
        const status = compliance.find((c) => c.storyId === s.id)?.status ?? 'compliant';
        return (
          <article key={s.id} className="card story" aria-labelledby={`${s.id}-title`}>
            <header className="row">
              <span className="mono">{s.id}</span>
              <h3 id={`${s.id}-title`}>{s.title}</h3>
              <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>
            </header>
            <p className="statement">
              As a <strong>{s.role}</strong>, I want <strong>{s.goal}</strong>, so that {s.benefit}.
            </p>
            <ul className="criteria">
              {s.acceptanceCriteria.map((ac, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: criteria have no identity and are never reordered.
                <li key={i}>
                  <b>Given</b> {ac.given} <b>when</b> {ac.when} <b>then</b> {ac.then}
                </li>
              ))}
            </ul>
            <footer className="row meta">
              <span className="badge">{s.priority.toUpperCase()}</span>
              <span>{s.storyPoints === null ? 'unestimated' : `${s.storyPoints} pts`}</span>
              {s.nfrRefs.length > 0 && <span>NFR: {s.nfrRefs.join(', ')}</span>}
              {s.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function FindingsPanel({ findings }: { findings: readonly Finding[] }) {
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const visible = findings.filter((f) => severity === 'all' || f.severity === severity);
  const groups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of visible) map.set(f.category, [...(map.get(f.category) ?? []), f]);
    return [...map];
  }, [visible]);

  return (
    <div className="stack">
      <label className="inline-field">
        <span>Severity</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
          aria-label="Filter by severity"
        >
          <option value="all">All ({findings.length})</option>
          <option value="error">Errors ({findings.filter((f) => f.severity === 'error').length})</option>
          <option value="warning">Warnings ({findings.filter((f) => f.severity === 'warning').length})</option>
          <option value="info">Info ({findings.filter((f) => f.severity === 'info').length})</option>
        </select>
      </label>
      {groups.length === 0 && <p className="empty">No findings — fully compliant with the selected paradigm.</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="card">
          <h3 className="category">{category}</h3>
          <ul className="findings">
            {items.map((f) => (
              <li key={`${f.ruleId}-${f.target.id}-${f.message}`} className={`finding sev-${f.severity}`}>
                <div className="row">
                  <span className={`badge sev-${f.severity}`}>{f.severity}</span>
                  <span className="mono">{f.ruleId}</span>
                  <strong>{f.ruleTitle}</strong>
                </div>
                <p>{f.message}</p>
                <p className="muted">
                  <b>Fix:</b> {f.remediation}
                </p>
                <p className="muted small">
                  {f.target.kind}: <span className="mono">{f.target.id}</span>
                  {f.storyRefs.length > 0 && <> · stories {f.storyRefs.join(', ')}</>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NFRs
// ---------------------------------------------------------------------------

export function NfrPanel({ nfrs }: { nfrs: readonly NonFunctionalRequirement[] }) {
  if (nfrs.length === 0) return <p className="empty">No non-functional requirements were identified.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Category</th>
            <th>Statement</th>
            <th>Metric</th>
            <th>Verification</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {nfrs.map((n) => (
            <tr key={n.id}>
              <td className="mono">{n.id}</td>
              <td>{n.category}</td>
              <td>{n.statement}</td>
              <td>
                {n.metric === null ? (
                  <span className="badge sev-warning">not measurable</span>
                ) : (
                  `${n.metric.name} ${n.metric.comparator} ${n.metric.target} ${n.metric.unit}`
                )}
              </td>
              <td>{n.verificationMethod ?? '—'}</td>
              <td>{n.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

export function RiskPanel({ risks }: { risks: readonly Risk[] }) {
  const levels = [5, 4, 3, 2, 1];
  return (
    <div className="risk-layout">
      <figure className="card heatmap" aria-label="Risk heat map">
        <figcaption>Likelihood × impact</figcaption>
        <table>
          <tbody>
            {levels.map((likelihood) => (
              <tr key={likelihood}>
                <th scope="row">L{likelihood}</th>
                {[1, 2, 3, 4, 5].map((impact) => {
                  const count = risks.filter((r) => r.likelihood === likelihood && r.impact === impact).length;
                  const score = likelihood * impact;
                  const level = score >= 20 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low';
                  return (
                    <td key={impact} className={`cell level-${level}`} title={`L${likelihood} × I${impact}`}>
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th />
              {[1, 2, 3, 4, 5].map((i) => (
                <th key={i} scope="col">
                  I{i}
                </th>
              ))}
            </tr>
          </tbody>
        </table>
      </figure>
      <ol className="stack risks">
        {risks.map((r) => (
          <li key={r.id} className="card">
            <div className="row">
              <span className={`badge level-${r.level}`}>{r.level}</span>
              <span className="mono">{r.id}</span>
              <strong>{r.title}</strong>
              <span className="muted small">
                {r.category} · L{r.likelihood} × I{r.impact} = {r.score} · {r.origin}
              </span>
            </div>
            <p>{r.description}</p>
            <p className="muted">
              <b>Mitigation:</b> {r.mitigation}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

function MendixBlueprintView({ design }: { design: MendixDesign }) {
  return (
    <div className="stack">
      {design.modules.map((m) => (
        <section key={m.name} className="card" aria-label={`Mendix module ${m.name}`}>
          <h3>Module {m.name}</h3>
          <h4>Domain model &amp; view models</h4>
          <div className="chips">
            {m.entities.map((e) => (
              <span
                key={e.name}
                className={`chip ${e.persistable ? 'persistent' : 'transient'}`}
                title={`${e.attributes.length} attributes`}
              >
                {e.name}
                <small>{e.persistable ? 'persistable' : `non-persistable · ${e.role}`}</small>
              </span>
            ))}
          </div>
          <h4>Nanoflows (client)</h4>
          <ul className="flows">
            {m.nanoflows.map((n) => (
              <li key={n.name}>
                <span className="mono">{n.name}</span>
                {n.microflowCalls.length > 0 && <span className="muted"> → {n.microflowCalls.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <h4>Microflows (server)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Called from</th>
                  <th>Activities</th>
                  <th>Decisions</th>
                  <th>Commits</th>
                  <th>Integrations</th>
                </tr>
              </thead>
              <tbody>
                {m.microflows.map((f) => (
                  <tr key={f.name}>
                    <td className="mono">{f.name}</td>
                    <td>{f.calledFrom}</td>
                    <td>{f.activityCount}</td>
                    <td>{f.decisionCount}</td>
                    <td>{f.commitCount}</td>
                    <td>{f.integrationCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Pages</h4>
          <ul className="flows">
            {m.pages.map((p) => (
              <li key={p.name}>
                <span className="mono">{p.name}</span> <span className="tag">{p.profile}</span>
                <span className="muted"> {p.actions.map((a) => `${a.trigger} → ${a.target}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const LAYERS: readonly { id: OsLayer; label: string }[] = [
  { id: 'end-user', label: 'End-User' },
  { id: 'core', label: 'Core' },
  { id: 'foundation', label: 'Foundation' },
];

function OutSystemsBlueprintView({ design }: { design: OutSystemsDesign }) {
  return (
    <section className="canvas" aria-label="OutSystems Architecture Canvas">
      {LAYERS.map((layer) => (
        <section key={layer.id} className={`lane lane-${layer.id}`} aria-label={`${layer.label} layer`}>
          <h3>{layer.label}</h3>
          <div className="lane-modules">
            {design.modules
              .filter((m) => OS_LAYER_OF_KIND[m.kind] === layer.id)
              .map((m) => (
                <article key={m.name} className="card module">
                  <header>
                    <span className="mono">{m.name}</span>
                    <span className="tag">{m.kind}</span>
                  </header>
                  <p className="muted small">
                    {m.entities.length} entities · {m.actions.length} actions · {m.queries.length} queries ·{' '}
                    {m.screens.length} screens
                  </p>
                  {m.references.length > 0 && <p className="small">→ {m.references.join(', ')}</p>}
                </article>
              ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function BlueprintPanel({ blueprint }: { blueprint: Blueprint }) {
  return (
    <div className="stack">
      <p className="summary">
        {blueprint.summary}{' '}
        <span className={`badge origin-${blueprint.origin}`}>
          {blueprint.origin === 'agent' ? 'AI-synthesised' : 'Deterministic'}
        </span>
      </p>
      {blueprint.paradigm === 'mendix' ? (
        <MendixBlueprintView design={blueprint.design} />
      ) : (
        <OutSystemsBlueprintView design={blueprint.design} />
      )}
    </div>
  );
}

export function DecisionsPanel({ decisions }: { decisions: readonly ArchitectureDecision[] }) {
  return (
    <ol className="stack">
      {decisions.map((d) => (
        <li key={d.id} className="card">
          <div className="row">
            <span className="mono">{d.id}</span>
            <strong>{d.title}</strong>
          </div>
          <p>{d.decision}</p>
          <p className="muted">{d.rationale}</p>
          <p className="small">
            Satisfies:{' '}
            {d.ruleRefs.map((r) => (
              <span key={r} className="tag mono">
                {r}
              </span>
            ))}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Agent trace
// ---------------------------------------------------------------------------

export function TracePanel({ traces }: { traces: readonly AgentRunTrace[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Served by</th>
            <th>Attempts</th>
            <th>Repairs</th>
            <th>Duration</th>
            <th>Tokens (in/out)</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t) => (
            <tr key={`${t.agent}-${t.correlationId}`} className={t.degraded ? 'degraded' : ''}>
              <td className="mono">{t.agent}</td>
              <td>
                {t.servedBy}
                {t.degraded && <span className="badge sev-warning">degraded</span>}
              </td>
              <td>{t.attempts.map((a) => `${a.provider}:${a.outcome}`).join(' → ')}</td>
              <td>{t.repairRounds}</td>
              <td>{t.durationMs} ms</td>
              <td>
                {t.usage.inputTokens}/{t.usage.outputTokens}
              </td>
              <td className="small">{t.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
