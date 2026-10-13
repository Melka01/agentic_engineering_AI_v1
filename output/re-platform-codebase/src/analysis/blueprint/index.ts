import type { BlueprintDraft } from '../../agents/schemas.js';
import type { Paradigm } from '../../shared/domain.js';
import type { Blueprint } from '../../shared/session.js';
import { type SynthesisInput, synthesizeMendixBlueprint } from './mendix.js';
import { synthesizeOutSystemsBlueprint } from './outsystems.js';

export type { SynthesisInput } from './mendix.js';
export { appName, synthesizeMendixBlueprint } from './mendix.js';
export { synthesizeOutSystemsBlueprint } from './outsystems.js';

/** Deterministic blueprint for the selected paradigm. */
export function synthesizeBlueprint(paradigm: Paradigm, input: SynthesisInput): BlueprintDraft {
  return paradigm === 'mendix' ? synthesizeMendixBlueprint(input) : synthesizeOutSystemsBlueprint(input);
}

/** Wraps an agent/deterministic draft into a session blueprint. */
export function toBlueprint(draft: BlueprintDraft, origin: Blueprint['origin']): Blueprint {
  if (draft.design.paradigm === 'mendix') {
    return { paradigm: 'mendix', design: draft.design, summary: draft.summary, decisions: draft.decisions, origin };
  }
  return { paradigm: 'outsystems', design: draft.design, summary: draft.summary, decisions: draft.decisions, origin };
}
