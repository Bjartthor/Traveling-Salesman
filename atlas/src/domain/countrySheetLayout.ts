// Shared between WorldMap (which frames a selected country above the sheet)
// and CountrySheet (which drags between these same heights) — one source of
// truth so the map's auto-zoom always leaves room for wherever the sheet
// actually sits.

// Height as a percentage of viewport height (vh).
export const COUNTRY_SHEET_PEEK_VH = 40
export const COUNTRY_SHEET_EXPANDED_VH = 88
// Drag below this on release closes the sheet instead of snapping to peek.
export const COUNTRY_SHEET_CLOSE_THRESHOLD_VH = 18
// How far the sheet may visually collapse while actively dragging, before release decides close-vs-snap.
export const COUNTRY_SHEET_MIN_DRAG_VH = 6
