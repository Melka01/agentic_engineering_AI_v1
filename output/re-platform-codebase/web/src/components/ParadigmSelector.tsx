import { type KeyboardEvent, useRef } from 'react';
import type { Paradigm } from '../../../src/shared/domain.js';
import { PARADIGM_LIST } from '../../../src/shared/paradigms.js';

export interface ParadigmSelectorProps {
  readonly value: Paradigm;
  readonly onChange: (paradigm: Paradigm) => void;
  readonly disabled?: boolean;
}

/**
 * Accessible radio group (WAI-ARIA radio pattern): one tab stop, arrow keys
 * move and select, Space/Enter select.
 */
export function ParadigmSelector({ value, onChange, disabled = false }: ParadigmSelectorProps) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const select = (index: number) => {
    const target = PARADIGM_LIST[(index + PARADIGM_LIST.length) % PARADIGM_LIST.length];
    if (target === undefined || disabled) return;
    onChange(target.id);
    refs.current[PARADIGM_LIST.indexOf(target)]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(index - 1);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      select(index);
    }
  };

  return (
    <div role="radiogroup" aria-label="Low-code paradigm" aria-disabled={disabled} className="paradigm-selector">
      {PARADIGM_LIST.map((paradigm, index) => {
        const checked = paradigm.id === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: each option is a rich card containing a list of principles, which a native <label>/<input type="radio"> cannot contain; this implements the WAI-ARIA APG radio-group pattern (roving tabindex, arrow keys, Space/Enter).
          <div
            key={paradigm.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="radio"
            aria-checked={checked}
            aria-labelledby={`paradigm-${paradigm.id}-name`}
            aria-describedby={`paradigm-${paradigm.id}-tagline`}
            tabIndex={checked && !disabled ? 0 : -1}
            data-paradigm={paradigm.id}
            className={`paradigm-card paradigm-${paradigm.id}${checked ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <div className="paradigm-head">
              <span className="radio-dot" aria-hidden="true" />
              <span id={`paradigm-${paradigm.id}-name`} className="paradigm-name">
                {paradigm.name}
              </span>
            </div>
            <p id={`paradigm-${paradigm.id}-tagline`} className="paradigm-tagline">
              {paradigm.tagline}
            </p>
            <ul className="principles" aria-label={`${paradigm.name} enforced best practices`}>
              {paradigm.principles.map((principle) => (
                <li key={principle.title}>
                  <strong>{principle.title}</strong>
                  <span>{principle.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
