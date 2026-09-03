/** Flatten nested Superforms / Zod error trees into unique human-readable messages. */
export function collectFormErrorMessages(errors: unknown): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	walk(errors, out, seen);
	return out;
}

function walk(node: unknown, out: string[], seen: Set<string>) {
	if (node == null) return;
	if (Array.isArray(node)) {
		for (const item of node) {
			if (typeof item === 'string') {
				const msg = item.trim();
				if (msg && !seen.has(msg)) {
					seen.add(msg);
					out.push(msg);
				}
			} else {
				walk(item, out, seen);
			}
		}
		return;
	}
	if (typeof node === 'object') {
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			if (key === '_errors') {
				walk(value, out, seen);
			} else {
				walk(value, out, seen);
			}
		}
	}
}
