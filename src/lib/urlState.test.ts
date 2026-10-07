import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, formatUrlState, parseUrlState } from './urlState';

describe('formatUrlState', () => {
  it('writes the line number a rider would say, not the route id', () => {
    expect(formatUrlState({ line: '550', mode: DEFAULT_MODE })).toBe('?linja=550');
  });

  it('leaves out the default filter so a plain link stays short', () => {
    expect(formatUrlState({ line: null, mode: DEFAULT_MODE })).toBe('');
  });

  it('writes the filter in Finnish, matching the interface around it', () => {
    expect(formatUrlState({ line: null, mode: 'tram' })).toBe('?moodi=raitiovaunu');
    expect(formatUrlState({ line: '4', mode: 'tram' })).toBe('?linja=4&moodi=raitiovaunu');
  });

  it('ignores a mode it has no slug for rather than inventing one', () => {
    expect(formatUrlState({ line: null, mode: 'funicular' })).toBe('');
  });
});

describe('parseUrlState', () => {
  it('reads a line and a filter back', () => {
    expect(parseUrlState('?linja=550&moodi=bussi')).toEqual({ line: '550', mode: 'bus' });
  });

  it('falls back to showing everything for a missing or unknown filter', () => {
    expect(parseUrlState('').mode).toBe(DEFAULT_MODE);
    expect(parseUrlState('?moodi=hevonen').mode).toBe(DEFAULT_MODE);
  });

  it('treats an empty parameter as absent', () => {
    expect(parseUrlState('?linja=&moodi=').line).toBeNull();
    expect(parseUrlState('?linja=   ').line).toBeNull();
  });

  it('tolerates surrounding whitespace and casing a hand-edited link may carry', () => {
    expect(parseUrlState('?linja=%20550%20&moodi=%20Raitiovaunu%20')).toEqual({
      line: '550',
      mode: 'tram',
    });
  });

  it('keeps a letter-bearing line intact', () => {
    expect(parseUrlState('?linja=M2').line).toBe('M2');
    expect(parseUrlState('?linja=587BK').line).toBe('587BK');
  });
});

describe('round trip', () => {
  it('survives format then parse unchanged', () => {
    for (const state of [
      { line: '550', mode: 'bus' },
      { line: null, mode: 'ferry' },
      { line: 'M2', mode: DEFAULT_MODE },
      { line: null, mode: DEFAULT_MODE },
    ]) {
      expect(parseUrlState(formatUrlState(state))).toEqual(state);
    }
  });
});
