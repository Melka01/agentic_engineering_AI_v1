import { type FormEvent, useState } from 'react';
import type { Paradigm } from '../../../src/shared/domain.js';
import type { SessionInputDraft } from '../../../src/shared/session.js';
import { ParadigmSelector } from './ParadigmSelector.js';

export const EXAMPLE_REQUIREMENTS = `Employees must be able to submit expense claims with photos of receipts from their phone, also when they are offline.
Managers can approve or reject expense claims within 2 working days.
Finance officers need to export approved claims to SAP every night.
Employees should search their previous claims.
The system must send a reminder e-mail to managers when a claim is pending for more than 3 days.
The portal must be available 99.9% of the time.
Pages must load within 2 seconds for 500 concurrent users.
All personal data must be encrypted and handled according to GDPR.`;

export interface SessionFormProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (input: SessionInputDraft) => void;
}

export function SessionForm({ busy, error, onSubmit }: SessionFormProps) {
  const [paradigm, setParadigm] = useState<Paradigm>('mendix');
  const [projectName, setProjectName] = useState('');
  const [requirementsText, setRequirementsText] = useState('');
  const [domainContext, setDomainContext] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ projectName: projectName.trim(), paradigm, requirementsText, domainContext });
  };

  const loadExample = () => {
    setProjectName('Expense Portal');
    setRequirementsText(EXAMPLE_REQUIREMENTS);
    setDomainContext('Mid-size company, 2,000 employees, finance team of 12, SAP S/4HANA as ERP.');
  };

  const tooShort = requirementsText.trim().length < 20;

  return (
    <form className="card session-form" onSubmit={submit} aria-label="New requirements session">
      <section>
        <h2>1. Select the low-code paradigm</h2>
        <p className="muted">
          The paradigm decides which best-practice rule engine validates the backlog and blueprint.
        </p>
        <ParadigmSelector value={paradigm} onChange={setParadigm} disabled={busy} />
      </section>

      <section>
        <h2>2. Describe the requirements</h2>
        <label className="field">
          <span>Project name</span>
          <input
            name="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            maxLength={120}
            required
            disabled={busy}
            placeholder="e.g. Expense Portal"
          />
        </label>
        <label className="field">
          <span>Stakeholder requirements</span>
          <textarea
            name="requirementsText"
            value={requirementsText}
            onChange={(e) => setRequirementsText(e.target.value)}
            rows={9}
            required
            disabled={busy}
            placeholder="One statement per line: who needs what, quality targets, integrations…"
          />
        </label>
        <label className="field">
          <span>
            Domain context <span className="muted">(optional)</span>
          </span>
          <textarea
            name="domainContext"
            value={domainContext}
            onChange={(e) => setDomainContext(e.target.value)}
            rows={3}
            disabled={busy}
            placeholder="Organisation, existing systems, constraints"
          />
        </label>
      </section>

      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={loadExample} disabled={busy}>
          Load example
        </button>
        <button type="submit" className="primary" disabled={busy || tooShort || projectName.trim() === ''}>
          {busy ? 'Running agents…' : 'Generate & validate'}
        </button>
      </div>
    </form>
  );
}
