// Vitest setup for SvelteKit virtual modules in DOM environments (happy-dom / jsdom)
if (typeof globalThis !== 'undefined') {
	const g = globalThis as unknown as { __sveltekit_dev?: { env: Record<string, string> } };
	if (!g.__sveltekit_dev) {
		g.__sveltekit_dev = { env: {} };
	}
}

// bits-ui restores `<body>` scroll on a 24ms timer after a dialog unmounts. If the test file ends
// first, the timer fires in a torn-down environment ("document is not defined") and Vitest fails
// the whole run. Wait it out only when a lock is still applied.
if (typeof document !== 'undefined') {
	const { afterEach } = await import('vitest');
	afterEach(async () => {
		if (document.body?.getAttribute('style')) {
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
	});
}
