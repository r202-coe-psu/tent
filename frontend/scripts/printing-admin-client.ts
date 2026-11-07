/**
 * CouchDB server-admin client for the printing ops script (`close-shelter-printing`). Runs under
 * plain `tsx` (no SvelteKit runtime), so it cannot import `$lib/server/couch-admin`; it shares only
 * the pure credential parsing and the `AdminRaw` type.
 * Needs COUCHDB_ADMIN_URL (environment or frontend/.env): http://admin:<password>@<host>:<port>
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { basicAuthHeader, parseCouchCredentialUrl } from '$lib/server/couch-credentials';
import type { AdminRaw } from '$lib/server/printers/printing-close';

function loadEnvFile(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf-8')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#') && line.includes('='))
			.map((line) => {
				const separator = line.indexOf('=');
				return [
					line.slice(0, separator).trim(),
					line
						.slice(separator + 1)
						.trim()
						.replace(/^['"]|['"]$/g, '')
				];
			})
	);
}

/** `adminRaw`-shaped client; exits the process when COUCHDB_ADMIN_URL is missing or malformed. */
export function loadAdminRaw(): AdminRaw {
	const raw = process.env.COUCHDB_ADMIN_URL ?? loadEnvFile().COUCHDB_ADMIN_URL;
	const credentials = parseCouchCredentialUrl(raw);
	if (!credentials) {
		console.error('✗ COUCHDB_ADMIN_URL is not set or malformed (set it in frontend/.env)');
		console.error('  Format: http://admin:<password>@<host>:<port>');
		process.exit(1);
	}
	const authorization = basicAuthHeader(credentials.user, credentials.password);

	return async (path, method, body) => {
		const res = await fetch(`${credentials.base}${path}`, {
			method,
			headers: {
				Authorization: authorization,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {})
		});
		const data = res.status === 204 ? null : await res.json().catch(() => null);
		return { status: res.status, data };
	};
}
