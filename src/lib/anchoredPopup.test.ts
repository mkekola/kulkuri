import { describe, expect, it } from 'vitest';
import { anchoredPositionAt } from './anchoredPopup';

// Mirrors the module's own private constants (POPUP_MAX_WIDTH: 300,
// POPUP_MARGIN: 12, POPUP_GAP: 14, POPUP_TAIL_INSET: 24) - not exported,
// so the expected numbers below are worked out by hand against them
// rather than imported.

describe('anchoredPositionAt', () => {
  it('centers the card on the point when there is room on all sides', () => {
    const result = anchoredPositionAt({ x: 700, y: 450 }, 1400, 900);
    expect(result.width).toBe(300);
    expect(result.left).toBe(550); // 700 - 300/2
    expect(result.tailOffset).toBe(150); // point sits under the card's own center
  });

  it('clamps to the left margin instead of running off the container', () => {
    const result = anchoredPositionAt({ x: 5, y: 450 }, 1400, 900);
    expect(result.left).toBe(12); // POPUP_MARGIN
    expect(result.tailOffset).toBe(24); // clamped to POPUP_TAIL_INSET, not negative
  });

  it('clamps to the right margin instead of running off the container', () => {
    const result = anchoredPositionAt({ x: 1395, y: 450 }, 1400, 900);
    expect(result.left).toBe(1088); // 1400 - 300 - 12
    expect(result.tailOffset).toBe(276); // clamped to width - POPUP_TAIL_INSET
  });

  it('shrinks the card width in a narrow container instead of overflowing it', () => {
    const result = anchoredPositionAt({ x: 100, y: 450 }, 200, 900);
    expect(result.width).toBe(176); // 200 - 12*2, well under the 300 max
  });

  it('never returns a negative width in a container narrower than the margins', () => {
    const result = anchoredPositionAt({ x: 5, y: 450 }, 10, 900);
    expect(result.width).toBe(0);
  });

  it('flips placement below the point above the 40%-of-height threshold', () => {
    const above = anchoredPositionAt({ x: 700, y: 361 }, 1400, 900);
    expect(above.placement).toBe('above');
    expect(above.top).toBe(361 - 14); // POPUP_GAP

    const below = anchoredPositionAt({ x: 700, y: 360 }, 1400, 900);
    expect(below.placement).toBe('below');
    expect(below.top).toBe(360 + 14);
  });
});
