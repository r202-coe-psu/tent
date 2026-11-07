function hasControlCharacter(value: string) {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

export function pathnameOf(href: string): string {
	const end = href.search(/[?#]/);
	return end === -1 ? href : href.slice(0, end);
}

export function safeInternalPath(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (hasControlCharacter(trimmed)) return null;
	if (!trimmed.startsWith('/')) return null;
	if (trimmed[1] === '/' || trimmed[1] === '\\') return null;
	return trimmed;
}

export function isSameDestination(cameFrom: string | null | undefined, destination: string) {
	if (!cameFrom) return false;
	return pathnameOf(cameFrom) === pathnameOf(destination);
}
