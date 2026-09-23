// Vitest setup for SvelteKit virtual modules in DOM environments (happy-dom / jsdom)
if (typeof globalThis !== 'undefined') {
	const g = globalThis as unknown as { __sveltekit_dev?: { env: Record<string, string> } };
	if (!g.__sveltekit_dev) {
		g.__sveltekit_dev = { env: {} };
	}
}
