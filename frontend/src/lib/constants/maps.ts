/**
 * Map configuration constants for MapLibre GL.
 * OpenFreeMap vector tile style endpoints:
 * - Liberty (default): High-load, free, open-source vector map style with clean road/building layers.
 * - Bright: Alternative bright vector map style.
 * - Positron: Minimal light vector map style.
 */
export const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const OPENFREEMAP_BRIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright';
export const OPENFREEMAP_POSITRON_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const DEFAULT_MAP_STYLE = OPENFREEMAP_LIBERTY_STYLE;
export const DEFAULT_MAP_CENTER: [number, number] = [100.473531, 7.009425];
export const DEFAULT_MAP_ZOOM = 11;
