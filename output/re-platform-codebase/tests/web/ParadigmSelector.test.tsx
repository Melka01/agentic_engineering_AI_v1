import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Paradigm } from '../../src/shared/domain.js';
import { ParadigmSelector } from '../../web/src/components/ParadigmSelector.js';

function Harness({ onChange, disabled = false }: { onChange?: (p: Paradigm) => void; disabled?: boolean }) {
  const [value, setValue] = useState<Paradigm>('mendix');
  return (
    <ParadigmSelector
      value={value}
      disabled={disabled}
      onChange={(p) => {
        setValue(p);
        onChange?.(p);
      }}
    />
  );
}

describe('ParadigmSelector', () => {
  it('renders an accessible radio group with Mendix selected by default', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Low-code paradigm' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeTruthy();
    expect(radios.map((r) => r.getAttribute('data-paradigm'))).toEqual(['mendix', 'outsystems']);
    expect(screen.getByRole('radio', { name: 'Mendix' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'OutSystems' }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows the enforced best practices of each platform', () => {
    render(<Harness />);
    expect(screen.getByRole('list', { name: 'Mendix enforced best practices' }).textContent).toContain(
      'Minimise round trips with nanoflows',
    );
    expect(screen.getByRole('list', { name: 'OutSystems enforced best practices' }).textContent).toContain(
      '3-layer Architecture Canvas',
    );
    expect(screen.getByRole('list', { name: 'OutSystems enforced best practices' }).textContent).toContain(
      'Aggregates over custom SQL',
    );
  });

  it('switches paradigm on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'OutSystems' }));
    expect(onChange).toHaveBeenCalledWith('outsystems');
    expect(screen.getByRole('radio', { name: 'OutSystems' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Mendix' }).getAttribute('aria-checked')).toBe('false');
  });

  it('supports roving keyboard selection with arrow keys', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const mendix = screen.getByRole('radio', { name: 'Mendix' });
    expect(mendix.tabIndex).toBe(0);
    fireEvent.keyDown(mendix, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('outsystems');
    const outsystems = screen.getByRole('radio', { name: 'OutSystems' });
    expect(outsystems.tabIndex).toBe(0);
    expect(document.activeElement).toBe(outsystems);
    fireEvent.keyDown(outsystems, { key: 'ArrowRight' }); // wraps around
    expect(onChange).toHaveBeenLastCalledWith('mendix');
  });

  it('ignores interaction while disabled', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole('radio', { name: 'OutSystems' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
