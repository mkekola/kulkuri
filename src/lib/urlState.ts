// What a shared link carries. Deliberately only the things that outlive the
// moment: a line still runs tomorrow, a specific vehicle does not, so a
// vehicle is never written here - a link that opens onto nothing is worse
// than no link at all.
export interface UrlState {
  // The line number a rider would say out loud ("550"), not the route id the
  // app keys on ("2550"). Measured against the live route list: 505 routes
  // carry 504 distinct line numbers, so this identifies a line in every case
  // but the H train, which resolves to whichever route matches first.
  line: string | null;
  // The sidebar's mode filter, as its internal key ('all', 'bus', ...).
  mode: string;
}

export const DEFAULT_MODE = 'all';

const LINE_PARAM = 'linja';
const MODE_PARAM = 'moodi';

// A URL is a small public API: a link someone shared has to keep working after
// the sidebar's wording changes, so these slugs are spelled out here instead
// of being derived from whatever modeLabel() happens to return today.
const MODE_SLUGS: Record<string, string> = {
  bus: 'bussi',
  tram: 'raitiovaunu',
  metro: 'metro',
  train: 'juna',
  ferry: 'lautta',
};

const SLUG_MODES: Record<string, string> = Object.fromEntries(
  Object.entries(MODE_SLUGS).map(([mode, slug]) => [slug, mode]),
);

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const line = params.get(LINE_PARAM)?.trim();
  const slug = params.get(MODE_PARAM)?.trim().toLowerCase();
  return {
    line: line ? line : null,
    // An unknown or misspelled filter falls back to showing everything rather
    // than to an empty map, so a mangled link still opens onto a working app.
    mode: (slug ? SLUG_MODES[slug] : undefined) ?? DEFAULT_MODE,
  };
}

// Returns the query string including its '?', or '' when nothing needs saying.
export function formatUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.line) params.set(LINE_PARAM, state.line);
  // The default filter is exactly what you get with no parameter at all, so
  // writing it out would only make a shared link longer without saying more.
  if (state.mode !== DEFAULT_MODE && MODE_SLUGS[state.mode]) {
    params.set(MODE_PARAM, MODE_SLUGS[state.mode]);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
