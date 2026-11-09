import { describe, expect, it } from 'vitest';
import { CLAIM_DIALOG_I18N } from './claim-dialog.i18n';

const THAI = /[฀-๿]/;

function flatten(value: unknown, path: string, out: Map<string, unknown>): void {
	if (typeof value === 'function') {
		out.set(path, (value as (...args: unknown[]) => unknown)('x'));
	} else if (value && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, path ? `${path}.${key}` : key, out);
		}
	} else {
		out.set(path, value);
	}
}

describe('CLAIM_DIALOG_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const th = new Map<string, unknown>();
		const en = new Map<string, unknown>();
		flatten(CLAIM_DIALOG_I18N.th, '', th);
		flatten(CLAIM_DIALOG_I18N.en, '', en);
		expect([...en.keys()].sort()).toEqual([...th.keys()].sort());
		const thai = [...en.entries()].filter(([, v]) => typeof v === 'string' && THAI.test(v));
		expect(thai).toEqual([]);
	});
});
