import { z } from 'zod';

export const sourceSchema = z.enum(['SPHERE_BASELINE', 'SHELTER_OVERRIDE']);
export type Source = z.infer<typeof sourceSchema>;

export const SOURCE_LABELS: Record<Source, string> = {
	SPHERE_BASELINE: 'ส่วนกลาง',
	SHELTER_OVERRIDE: 'เฉพาะศูนย์พักพิงนี้'
};

export const SOURCE_OPTIONS = [
	{ value: 'SPHERE_BASELINE', label: 'ส่วนกลาง' },
	{ value: 'SHELTER_OVERRIDE', label: 'เฉพาะศูนย์พักพิงนี้' }
] as const;

/**
 * Returns human-readable label for a given source string.
 */
export function getSourceLabel(source: Source | string | null | undefined): string {
	if (!source) return '—';
	return SOURCE_LABELS[source as Source] ?? source;
}

/**
 * Resolves source based on shelter code context.
 * If shelterCode is present, returns 'SHELTER_OVERRIDE', otherwise 'SPHERE_BASELINE'.
 */
export function resolveSource(shelterCode?: string | null): Source {
	return shelterCode ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE';
}
