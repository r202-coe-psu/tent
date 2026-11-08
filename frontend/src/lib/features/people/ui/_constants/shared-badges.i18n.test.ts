import { describe, expect, it } from 'vitest';
import { SHARED_BADGES_I18N } from './shared-badges.i18n';

const THAI = /[฀-๿]/;

function keySet(value: unknown, prefix = ''): string[] {
	if (!value || typeof value !== 'object') return [prefix];
	return Object.entries(value).flatMap(([k, v]) => keySet(v, prefix ? `${prefix}.${k}` : k));
}

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function')
		return [String((value as (...a: unknown[]) => unknown)('1', 2, 3))];
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('SHARED_BADGES_I18N', () => {
	it('has identical key sets in th and en', () => {
		expect(keySet(SHARED_BADGES_I18N.en).sort()).toEqual(keySet(SHARED_BADGES_I18N.th).sort());
	});

	it('contains no Thai characters in en', () => {
		expect(strings(SHARED_BADGES_I18N.en).filter((s) => THAI.test(s))).toEqual([]);
	});
});

describe('SHARED_BADGES_I18N th labels', () => {
	it('match the exported badge style labels so Thai output is unchanged', async () => {
		const { REGISTERED_VIA_BADGE_STYLES } = await import('../shared/registered-via-badge.svelte');
		for (const [via, label] of Object.entries(SHARED_BADGES_I18N.th.via)) {
			expect(REGISTERED_VIA_BADGE_STYLES[via].label).toBe(label);
		}
	});
});
