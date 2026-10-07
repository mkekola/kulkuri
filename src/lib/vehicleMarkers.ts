// The disc drawn behind a vehicle's line number: a white center with a ring
// in the vehicle's mode color. White rather than the mode color itself so the
// number keeps the same (very high) contrast on every mode and on both
// basemaps - the mode colors are light enough that dark-on-color works in the
// sidebar's badges but colored-on-white does not, bottoming out at 1.79:1 for
// the ferry teal against white.
const RASTER_SIZE = 56;
const PIXEL_RATIO = 2;
const RING_WIDTH = 6;
const RADIUS = RASTER_SIZE / 2 - RING_WIDTH / 2 - 0.5;

// Only this 2px strip in the middle stretches, so icon-text-fit turns the
// disc into a capsule for long line numbers instead of inflating it in both
// directions. The fixed caps also set a floor on the size: a one-character
// number can never shrink the marker below a circle.
const STRETCH: [number, number][] = [[RASTER_SIZE / 2 - 1, RASTER_SIZE / 2 + 1]];
// The inner box the number is laid into, kept inside the circle's inscribed
// square (which spans 8.2..47.8 at this radius).
const CONTENT: [number, number, number, number] = [10, 10, 46, 46];

// Same ink the sidebar's line badges use (--on-fill in style.css), so a line
// number reads the same whether you meet it on the map or in the list.
export const VEHICLE_LABEL_COLOR = '#0a0f1c';
export const VEHICLE_LABEL_SIZE = 11;
// Below this the numbers are unreadable anyway: measured against the live HFP
// feed, a city-center view holds ~300 vehicles at zoom 13 and only a third of
// their numbers survive collision, while zoom 14 holds ~136 and fits two
// thirds of them with a fraction of the label churn.
export const VEHICLE_LABEL_MIN_ZOOM = 13.4;
export const VEHICLE_LABEL_FULL_ZOOM = 14;

// HFP's topic carries whatever segment the feed put there, so a mode nothing
// registered an image for has to land somewhere rather than making MapLibre
// warn about a missing icon on every frame.
export const UNKNOWN_VEHICLE_MODE = 'unknown';

export function vehicleDiscId(mode: string): string {
  return `vehicle-disc-${mode}`;
}

function buildDiscSvg(ringColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_SIZE}" height="${RASTER_SIZE}"><circle cx="${RASTER_SIZE / 2}" cy="${RASTER_SIZE / 2}" r="${RADIUS}" fill="#ffffff" stroke="${ringColor}" stroke-width="${RING_WIDTH}"/></svg>`;
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to rasterize vehicle disc'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export interface LoadedVehicleDisc {
  id: string;
  image: HTMLImageElement;
  pixelRatio: number;
  stretchX: [number, number][];
  stretchY: [number, number][];
  content: [number, number, number, number];
}

export async function loadVehicleDiscs(
  modeColors: Record<string, string>,
  fallbackColor: string,
): Promise<LoadedVehicleDisc[]> {
  const specs = Object.entries(modeColors).map(([mode, color]) => ({
    id: vehicleDiscId(mode),
    svg: buildDiscSvg(color),
  }));
  specs.push({ id: vehicleDiscId(UNKNOWN_VEHICLE_MODE), svg: buildDiscSvg(fallbackColor) });

  const images = await Promise.all(specs.map((s) => loadImage(s.svg)));
  return specs.map((s, i) => ({
    id: s.id,
    image: images[i],
    pixelRatio: PIXEL_RATIO,
    stretchX: STRETCH,
    stretchY: STRETCH,
    content: CONTENT,
  }));
}

// Rarer modes outrank buses. A tram or train number is the one you cannot
// guess from the dot's color alone (there are ten tram lines, not hundreds),
// and they are few enough that giving them the collision tie-break costs
// buses almost nothing. A selected line always outranks everything, so
// picking a line never hides the numbers you picked it to see.
const MODE_RANK: Record<string, number> = { train: 0, metro: 1, ferry: 2, tram: 3, bus: 4 };
const UNKNOWN_MODE_RANK = 5;
const SELECTED_ROUTE_BOOST = -10;

// Feeds symbol-sort-key: MapLibre places lower keys first, and whatever is
// placed first wins the space. A key derived from mode rather than from screen
// position is the point - position changes every frame as vehicles move, so
// position-ordered placement makes numbers flicker on and off. Measured in the
// prototype: ~99 label changes per second ordered by position, ~35 ordered by
// this.
export function labelPriority(mode: string, isSelectedRoute: boolean): number {
  const rank = MODE_RANK[mode] ?? UNKNOWN_MODE_RANK;
  return isSelectedRoute ? SELECTED_ROUTE_BOOST + rank : rank;
}
