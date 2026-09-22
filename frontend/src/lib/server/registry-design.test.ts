import { describe, expect, it } from 'vitest';
import {
	buildRegistryDesignDoc,
	REGISTRY_DESIGN_VERSION,
	registryByNamePath
} from './registry-design';

describe('registry shelter lookup design', () => {
	it('contains the indexed normalized-name view used by import duplicate checks', () => {
		const design = buildRegistryDesignDoc();

		expect(design.version).toBe(REGISTRY_DESIGN_VERSION);
		expect(design.views.by_normalized_name.map).toContain("doc.type === 'shelter'");
		expect(design.views.by_normalized_name.map).toContain("replace(/\\s+/g, ' ')");
	});

	it('normalizes the lookup key before generating the CouchDB view query', () => {
		const path = registryByNamePath('  ศูนย์   A  ');

		expect(path).toContain('by_normalized_name');
		expect(path).toContain(encodeURIComponent(JSON.stringify('ศูนย์ a')));
	});
});
