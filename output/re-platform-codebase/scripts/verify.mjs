#!/usr/bin/env node
/**
 * End-to-end verification: typecheck → lint → tests → build → live HTTP smoke
 * test of the production server (both paradigms, paradigm switch, rule-engine
 * validation, static UI). Writes reports/verification-report.{md,json} and
 * exits non-zero when any step fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = path.join(root, 'reports');
mkdirSync(reports, { recursive: true });
const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const tail = (text, lines = 20) => text.trim().split('\n').slice(-lines).join('\n');
const steps = [];

function step(name, cmd, args) {
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const record = {
    name,
    command: [cmd, ...args].join(' '),
    ok: result.status === 0,
    exitCode: result.status,
    durationMs: Date.now() - started,
    outputTail: tail(output),
  };
  steps.push(record);
  process.stdout.write(`${record.ok ? 'PASS' : 'FAIL'}  ${name} (${record.durationMs} ms)\n`);
  return record;
}

step('Type check (server + web, strict)', npm, ['run', 'typecheck']);
step('Lint & format (Biome)', npm, ['run', 'lint']);
step('Unit, integration & UI tests (Vitest)', npx, [
  'vitest',
  'run',
  '--reporter=default',
  '--reporter=json',
  '--outputFile=reports/test-results.json',
]);
step('Production build (tsc + Vite)', npm, ['run', 'build']);

// ---------------------------------------------------------------------------
// Live smoke test against the built server
// ---------------------------------------------------------------------------
const port = 3917;
const base = `http://127.0.0.1:${port}`;
const smoke = [];
const check = (name, ok, detail) => {
  smoke.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? '  ok ' : '  ERR'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
};

async function request(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const requirementsText = `Employees must be able to submit expense claims with photos of receipts, also when they are offline.
Managers can approve or reject expense claims within 2 working days.
Finance officers need to export approved claims to SAP every night.
Employees should search their previous claims.
The portal must be available 99.9% of the time.
Pages must load within 2 seconds for 500 concurrent users.
All personal data must be encrypted and handled according to GDPR.`;

const story = {
  id: 'US-001',
  title: 'Submit claim',
  role: 'employee',
  goal: 'submit an expense claim',
  benefit: 'I am reimbursed in the next payment run',
  acceptanceCriteria: [{ given: 'a draft claim', when: 'I submit it', then: 'its status is Submitted' }],
  priority: 'must',
  storyPoints: 3,
  nfrRefs: [],
  tags: [],
};

async function smokeTest() {
  const started = Date.now();
  if (!existsSync(path.join(root, 'dist/server/index.js'))) {
    check('server build present', false, 'dist/server/index.js missing');
    return Date.now() - started;
  }
  const server = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: root,
    env: { ...env, PORT: String(port), HOST: '127.0.0.1', RE_AI_MODE: 'offline', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      try {
        up = (await fetch(`${base}/api/health`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    check('server starts and reports healthy', up, up ? base : tail(serverLog, 5));
    if (!up) return Date.now() - started;

    const health = await request('GET', '/api/health');
    check(
      'GET /api/health',
      health.status === 200 && health.json?.aiMode === 'offline',
      `aiMode=${health.json?.aiMode}`,
    );
    check(
      'security headers',
      health.headers.get('x-frame-options') === 'DENY' && health.headers.get('content-security-policy') !== null,
    );

    const paradigms = await request('GET', '/api/paradigms');
    check(
      'GET /api/paradigms lists Mendix and OutSystems',
      paradigms.json?.map?.((p) => p.id).join(',') === 'mendix,outsystems',
      paradigms.json?.map?.((p) => `${p.id}:${p.ruleCount} rules`).join(', '),
    );

    const mx = await request('POST', '/api/sessions', {
      projectName: 'Expense Portal',
      paradigm: 'mendix',
      requirementsText,
    });
    check(
      'POST /api/sessions (Mendix)',
      mx.status === 201 &&
        mx.json?.validation?.engine === 'mendix-best-practice-engine' &&
        mx.json?.blueprint?.paradigm === 'mendix',
      `stories=${mx.json?.stories?.length} nfrs=${mx.json?.nfrs?.length} score=${mx.json?.validation?.summary?.score} passed=${mx.json?.validation?.summary?.passed} risks=${mx.json?.risks?.length}`,
    );

    const os = await request('POST', '/api/sessions', {
      projectName: 'Expense Portal',
      paradigm: 'outsystems',
      requirementsText,
    });
    const kinds = os.json?.blueprint?.design?.modules?.map((m) => m.kind) ?? [];
    check(
      'POST /api/sessions (OutSystems, 3-layer canvas)',
      os.status === 201 &&
        ['end-user', 'business-process', 'core-entities', 'connector', 'library'].every((k) => kinds.includes(k)),
      `modules=${os.json?.blueprint?.design?.modules?.map((m) => m.name).join(', ')} score=${os.json?.validation?.summary?.score}`,
    );

    const switched = await request('PUT', `/api/sessions/${mx.json?.id}/paradigm`, { paradigm: 'outsystems' });
    check(
      'PUT /api/sessions/:id/paradigm (Mendix → OutSystems)',
      switched.status === 200 &&
        switched.json?.paradigm === 'outsystems' &&
        switched.json?.blueprint?.paradigm === 'outsystems' &&
        JSON.stringify(switched.json?.stories) === JSON.stringify(mx.json?.stories),
      `history=${switched.json?.history?.map((h) => h.type).join(' → ')}`,
    );

    const osViolation = await request('POST', '/api/validate', {
      paradigm: 'outsystems',
      stories: [story],
      design: {
        paradigm: 'outsystems',
        userRoles: [],
        modules: [
          {
            name: 'Orders_CS',
            kind: 'core-entities',
            references: ['Erp_IS'],
            entities: [],
            actions: [],
            queries: [],
            screens: [],
          },
          {
            name: 'Erp_IS',
            kind: 'connector',
            references: ['Orders_CS'],
            entities: [],
            actions: [],
            queries: [
              {
                name: 'GetOrders',
                kind: 'advanced-sql',
                sources: 1,
                maxRecords: null,
                returnsList: true,
                fetch: 'server-action',
                insideLoop: true,
                sqlJustification: 'none',
                usesExpandInline: true,
                screen: null,
                storyRefs: ['US-001'],
              },
            ],
            screens: [],
          },
        ],
      },
    });
    const osRules = osViolation.json?.findings?.map((f) => f.ruleId) ?? [];
    check(
      'OutSystems engine rejects cycle, upward ref and unsafe SQL',
      ['OS-ARCH-001', 'OS-ARCH-003', 'OS-DATA-001', 'OS-DATA-002', 'OS-DATA-003'].every((r) => osRules.includes(r)) &&
        osViolation.json?.summary?.passed === false,
      [...new Set(osRules)].join(', '),
    );

    const mxViolation = await request('POST', '/api/validate', {
      paradigm: 'mendix',
      stories: [story],
      design: {
        paradigm: 'mendix',
        userRoles: [],
        modules: [
          {
            name: 'Sales',
            entities: [
              {
                name: 'OrderSearchVM',
                persistable: true,
                role: 'view',
                attributes: [{ name: 'IsSelected', type: 'Boolean', indexed: false }],
                associations: [],
                storyRefs: ['US-001'],
              },
            ],
            microflows: [
              {
                name: 'ACT_ToggleDetails',
                activityCount: 45,
                decisionCount: 2,
                loopCount: 1,
                maxLoopNesting: 1,
                retrieves: [],
                commitCount: 0,
                commitsInLoop: false,
                integrationCalls: 0,
                hasErrorHandling: true,
                calledFrom: 'page',
                subMicroflows: [],
                storyRefs: ['US-001'],
              },
            ],
            nanoflows: [],
            pages: [],
          },
        ],
      },
    });
    const mxRules = mxViolation.json?.findings?.map((f) => f.ruleId) ?? [];
    check(
      'Mendix engine rejects persisted view model, UI state, page-only microflow, oversized microflow',
      ['MX-DM-001', 'MX-DM-002', 'MX-RT-001', 'MX-MF-001'].every((r) => mxRules.includes(r)) &&
        mxViolation.json?.summary?.passed === false,
      [...new Set(mxRules)].join(', '),
    );

    const bad = await request('POST', '/api/sessions', {
      projectName: '',
      paradigm: 'powerapps',
      requirementsText: 'x',
    });
    check('invalid input → 400 validation_error', bad.status === 400 && bad.json?.error === 'validation_error');

    const ui = await request('GET', '/');
    check(
      'GET / serves the web UI',
      ui.status === 200 && ui.text.includes('<div id="root">'),
      `${ui.text.length} bytes`,
    );
  } finally {
    server.kill('SIGTERM');
  }
  return Date.now() - started;
}

const smokeDuration = await smokeTest();
steps.push({
  name: 'Live HTTP smoke test (built server, offline agents)',
  command: `node dist/server/index.js (PORT=${port}, RE_AI_MODE=offline)`,
  ok: smoke.length > 0 && smoke.every((c) => c.ok),
  exitCode: null,
  durationMs: smokeDuration,
  outputTail: smoke.map((c) => `${c.ok ? 'ok ' : 'ERR'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n'),
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let tests = null;
try {
  const json = JSON.parse(readFileSync(path.join(reports, 'test-results.json'), 'utf8'));
  tests = {
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    files: json.testResults.map((r) => ({
      file: path.relative(root, r.name),
      status: r.status,
      tests: r.assertionResults.length,
      failed: r.assertionResults.filter((a) => a.status !== 'passed').length,
    })),
  };
} catch {
  tests = null;
}

const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'n/a';
const allOk = steps.every((s) => s.ok);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  commit: git,
  passed: allOk,
  steps,
  tests,
  smoke,
};
writeFileSync(path.join(reports, 'verification-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const md = [
  '# Verification report',
  '',
  `- Generated: ${report.generatedAt}`,
  `- Node: ${report.node} (${report.platform})`,
  `- Commit (HEAD at run time): ${report.commit}`,
  `- **Overall: ${allOk ? 'PASS' : 'FAIL'}**`,
  '',
  '## Steps',
  '',
  '| Step | Result | Duration | Command |',
  '|------|--------|----------|---------|',
  ...steps.map((s) => `| ${s.name} | ${s.ok ? 'pass' : 'fail'} | ${s.durationMs} ms | \`${s.command}\` |`),
  '',
  '## Tests',
  '',
  tests === null
    ? 'Test results unavailable.'
    : [
        `${tests.passed}/${tests.total} tests passed, ${tests.failed} failed.`,
        '',
        '| File | Status | Tests | Failed |',
        '|------|--------|-------|--------|',
        ...tests.files.map((f) => `| ${f.file} | ${f.status} | ${f.tests} | ${f.failed} |`),
      ].join('\n'),
  '',
  '## Live smoke test',
  '',
  '| Check | Result | Detail |',
  '|-------|--------|--------|',
  ...smoke.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'fail'} | ${(c.detail ?? '').replaceAll('|', '\\|')} |`),
  '',
  '## Step output (tail)',
  '',
  ...steps.flatMap((s) => [`### ${s.name}`, '', '```text', s.outputTail || '(no output)', '```', '']),
].join('\n');
writeFileSync(path.join(reports, 'verification-report.md'), `${md}\n`);

process.stdout.write(`\n${allOk ? 'VERIFICATION PASSED' : 'VERIFICATION FAILED'} — reports/verification-report.md\n`);
process.exit(allOk ? 0 : 1);
