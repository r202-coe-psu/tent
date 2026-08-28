/**
 * Resolve a master-data code (ULID `item_…` or legacy free-text) to a display
 * label for the public portal. Public shelter payloads keep codes as-is;
 * human labels live in CouchDB `master_data` and are fetched via the BFF
 * config endpoints.
 */
export function toLabelMap(
	items: { code: string; label: string }[] | null | undefined
): Record<string, string> {
	const map: Record<string, string> = {};
	for (const item of items ?? []) {
		if (item.code && item.label) map[item.code] = item.label;
	}
	return map;
}

/**
 * Prefer the live master-data label, then a hard-coded legacy fallback, then
 * the raw value when it is not a ULID code. Never surface `item_…` IDs to
 * citizens (hide while loading or if the code is missing from the registry).
 */
export function resolveMasterLabel(
	code: string | null | undefined,
	labels: Record<string, string> | undefined,
	legacyFallbacks?: Record<string, string>
): string {
	if (!code) return '';
	const fromMaster = labels?.[code];
	if (fromMaster) return fromMaster;
	const fromLegacy = legacyFallbacks?.[code];
	if (fromLegacy) return fromLegacy;
	if (code.startsWith('item_')) return '';
	return code;
}
