import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App.js';
import { createInBrowserApiClient } from '../src/browser-api.js';
import { EXAMPLE_REQUIREMENTS } from '../src/components/SessionForm.js';
import '../src/styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

const api = createInBrowserApiClient();

createRoot(root).render(
  <StrictMode>
    <div className="app demo-shell">
      <p className="demo-banner" role="note">
        <strong>Browser demo</strong>
        <span>
          The real Mendix and OutSystems rule engines and the offline agents run in this page. The form holds an example
          expense-claims project; edit it or write your own. Claude-generated stories need the server and an API key.
        </span>
      </p>
    </div>
    <App
      api={api}
      formDefaults={{
        projectName: 'Expense Portal (example)',
        paradigm: 'mendix',
        requirementsText: EXAMPLE_REQUIREMENTS,
        domainContext: 'Example: mid-size company, 2,000 employees, finance team of 12, SAP S/4HANA as ERP.',
      }}
    />
  </StrictMode>,
);
