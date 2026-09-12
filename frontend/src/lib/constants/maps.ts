/**
 * Map configuration constants for MapLibre GL.
 * OpenStreetMap standard raster tile style — 100% free, open-source, no API keys,
 * robust and free of vector expression null-evaluation issues.
 */
export const OSM_RASTER_STYLE = {
	version: 8 as const,
	sources: {
		osm: {
			type: 'raster' as const,
			tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
			tileSize: 256,
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
		}
	},
	layers: [
		{
			id: 'osm',
			type: 'raster' as const,
			source: 'osm',
			minzoom: 0,
			maxzoom: 19
		}
	]
};

export const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const OPENFREEMAP_BRIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright';
export const OPENFREEMAP_POSITRON_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const DEFAULT_MAP_STYLE = OSM_RASTER_STYLE;
export const DEFAULT_MAP_CENTER: [number, number] = [100.473531, 7.009425];
export const DEFAULT_MAP_ZOOM = 13;
