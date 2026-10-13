/**
 * Regenerates docs/RULES.md from the executable rule catalogue (single source of truth).
 *   npm run docs:rules
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, ENGINE_VERSION } from '../src/engines/registry.js';
import { PARADIGMS } from '../src/shared/domain.js';
import { PARADIGM_DESCRIPTORS } from '../src/shared/paradigms.js';

const lines: string[] = [
  '# Rule catalogue',
  '',
  `Generated from the rule engines (engine version ${ENGINE_VERSION}) by \`npm run docs:rules\` — do not edit by hand.`,
  '',
];
const common = new Set<string>();
for (const paradigm of PARADIGMS) {
  const engine = createEngine(paradigm);
  const platform = engine.catalog.filter((r) => r.id.startsWith('MX-') || r.id.startsWith('OS-'));
  for (const r of engine.catalog) if (!platform.includes(r)) common.add(JSON.stringify(r));
  lines.push(`## ${PARADIGM_DESCRIPTORS[paradigm].name} (${platform.length} platform rules)`, '');
  lines.push('| Id | Severity | Category | Rule | Rationale |', '|----|----------|----------|------|-----------|');
  for (const r of platform) lines.push(`| ${r.id} | ${r.severity} | ${r.category} | ${r.title} | ${r.rationale} |`);
  lines.push('', '**Modelling guidance injected into the blueprint agent prompt:**', '');
  for (const g of engine.designGuidance()) lines.push(`- ${g}`);
  lines.push('');
}
const commonRules = [...common].map(
  (r) => JSON.parse(r) as { id: string; severity: string; category: string; title: string; rationale: string },
);
lines.push(`## Common rules — both paradigms (${commonRules.length})`, '');
lines.push('| Id | Severity | Category | Rule | Rationale |', '|----|----------|----------|------|-----------|');
for (const r of commonRules) lines.push(`| ${r.id} | ${r.severity} | ${r.category} | ${r.title} | ${r.rationale} |`);
lines.push(
  '',
  'Severity semantics: `error` blocks compliance (and triggers blueprint repair / deterministic replacement), `warning` lowers the score, `info` is advisory.',
  '',
);

const target = fileURLToPath(new URL('../docs/RULES.md', import.meta.url));
writeFileSync(target, `${lines.join('\n')}\n`);
console.log(`Wrote ${target}`);
