/** Client calls for link-on-first-login (CR-141) — `/api/v1/auth/link-account*`. */

export interface PendingLinkInfo {
	provider: 'google' | 'thaid';
	display: string;
}

/** The OAuth identity waiting to be linked, or null when none / expired. */
export async function fetchPendingLink(
	fetchFn: typeof fetch = fetch
): Promise<PendingLinkInfo | null> {
	try {
		const res = await fetchFn('/api/v1/auth/link-account/pending', {
			headers: { Accept: 'application/json' },
			credentials: 'include'
		});
		if (!res.ok) return null;
		const data = (await res.json()) as Partial<PendingLinkInfo>;
		if (data.provider !== 'google' && data.provider !== 'thaid') return null;
		return {
			provider: data.provider,
			display: typeof data.display === 'string' ? data.display : ''
		};
	} catch {
		return null;
	}
}

export async function cancelPendingLink(): Promise<void> {
	await fetch('/api/v1/auth/link-account/pending', {
		method: 'DELETE',
		credentials: 'include'
	}).catch(() => undefined);
}

/** Thrown by {@link linkAccount}; `code` mirrors the server envelope. */
export class LinkAccountError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'LinkAccountError';
	}
}

/** Codes after which the pending identity is gone — the user must restart OAuth. */
export const LINK_TERMINAL_CODES = new Set(['LINK_EXPIRED', 'RATE_LIMITED', 'CONFLICT']);

export async function linkAccount(input: {
	login: string;
	password: string;
	captcha_token?: string;
}): Promise<void> {
	const res = await fetch('/api/v1/auth/link-account', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		credentials: 'include',
		body: JSON.stringify(input)
	});
	if (res.ok) return;
	const body = (await res.json().catch(() => null)) as {
		error?: { code?: string; message?: string };
	} | null;
	throw new LinkAccountError(
		body?.error?.code ?? 'INTERNAL',
		body?.error?.message ?? 'เชื่อมบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
	);
}
