/** Test helper: asserts an i18n dictionary's EN mirrors TH and holds no Thai characters. */
const THAI = /[฀-๿]/;

function flatten(
	value: unknown,
	path: string,
	out: Map<string, unknown>,
	sample: readonly unknown[]
): void {
	if (typeof value === 'function') {
		out.set(path, (value as (...args: unknown[]) => unknown)(...sample));
		return;
	}
	if (value && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, path ? `${path}.${key}` : key, out, sample);
		}
		return;
	}
	out.set(path, value);
}

export function flattenDictionary(dict: unknown, sample: readonly unknown[] = ['x', 2, 3]) {
	const out = new Map<string, unknown>();
	flatten(dict, '', out, sample);
	return out;
}

/** Returns key-set diff and the EN paths that still contain Thai. */
export function compareLanguages(dict: { th: unknown; en: unknown }) {
	const th = flattenDictionary(dict.th);
	const en = flattenDictionary(dict.en);
	const thKeys = [...th.keys()].sort();
	const enKeys = [...en.keys()].sort();
	const thaiInEn = [...en.entries()]
		.filter(([, v]) => typeof v === 'string' && THAI.test(v))
		.map(([k]) => k);
	return { thKeys, enKeys, thaiInEn };
}
