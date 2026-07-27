import { SHELTER_DASHBOARD_VIEWS } from './views';

export const SHELTER_DASHBOARD_DESIGN_NAME = 'dashboard';

export type CouchViewDefinition = {
	map: string;
	reduce?: string;
};

export type ShelterViewModule = {
	module: string;
	version: number;
	stableDesignName: string;
	legacyDesignName?: string;
	views: Record<string, CouchViewDefinition>;
};

/**
 * Map/Reduce manifests owned by the shelter-view lifecycle.
 * Add a module here only when its View definition and consumers are ready.
 */
export const SHELTER_VIEW_MODULES: Record<string, ShelterViewModule> = {
	dashboard: {
		module: 'dashboard',
		version: 2,
		stableDesignName: SHELTER_DASHBOARD_DESIGN_NAME,
		legacyDesignName: 'app',
		views: SHELTER_DASHBOARD_VIEWS.views
	}
};

export function getShelterViewModule(moduleName: string): ShelterViewModule {
	const manifest = SHELTER_VIEW_MODULES[moduleName];
	if (!manifest) {
		throw new Error(
			`Unknown shelter View module "${moduleName}". Available: ${Object.keys(SHELTER_VIEW_MODULES).join(', ')}`
		);
	}
	return manifest;
}
