export interface AnchoredPosition {
  left: number;
  top: number;
  width: number;
  placement: 'above' | 'below';
  // Distance from the card's own left edge to where the tail should sit -
  // stays pointing at the real screen point even when the card itself had
  // to shift sideways to stay clear of the map's edge.
  tailOffset: number;
}

const POPUP_MAX_WIDTH = 300;
const POPUP_MARGIN = 12;
// Gap between the point and the card, sized to leave room for the tail.
const POPUP_GAP = 14;
// Keeps the tail clear of the card's own rounded corners.
const POPUP_TAIL_INSET = 24;

// Positions a small card next to a point in screen space (from
// map.project()) - a clicked vehicle or stop - clamped to stay within its
// container instead of running off the map's edge. Flips above/below based
// on roughly where in the container the point sits, rather than the card's
// actual rendered height, which isn't known at this point (no
// ResizeObserver here) - a reasonable approximation for a card whose
// content varies only in length, not in kind.
export function anchoredPositionAt(
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
): AnchoredPosition {
  const width = Math.min(POPUP_MAX_WIDTH, Math.max(0, containerWidth - POPUP_MARGIN * 2));
  const halfWidth = width / 2;
  const left = Math.min(
    Math.max(point.x - halfWidth, POPUP_MARGIN),
    Math.max(POPUP_MARGIN, containerWidth - width - POPUP_MARGIN),
  );
  const tailOffset = Math.min(Math.max(point.x - left, POPUP_TAIL_INSET), width - POPUP_TAIL_INSET);
  const placement: 'above' | 'below' = point.y > containerHeight * 0.4 ? 'above' : 'below';
  const top = placement === 'above' ? point.y - POPUP_GAP : point.y + POPUP_GAP;
  return { left, top, width, placement, tailOffset };
}
