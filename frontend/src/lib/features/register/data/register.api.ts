// Self-signup runs on the server endpoint (/api/register), which holds the
// admin credentials needed to create the CouchDB user and grant notes access.
// The browser never sees the admin password.

export async function registerUser(name: string, password: string): Promise<void> {
	const res = await fetch('/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: name, password })
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(data?.message ?? `Registration failed (${res.status})`);
	}
}
