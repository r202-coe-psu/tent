import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (worker: unknown, message: unknown) => void;
type Sent = { sessions: { id: string; status: string; citizen?: unknown }[] };

const CITIZEN = { pid: '1234567890123', sub: 'sub-1' };
const BINDING = { device_id: 'scanner-device:A', shelter_code: 'SH001' };

async function startPrimary() {
	vi.resetModules();
	vi.stubEnv('WEB_CONCURRENCY', '2');
	let handler: Handler | undefined;
	vi.doMock('node:os', () => ({ availableParallelism: () => 4 }));
	vi.doMock('node:cluster', () => ({
		default: {
			isPrimary: true,
			workers: {},
			fork: vi.fn(),
			on: (event: string, fn: Handler) => {
				if (event === 'message') handler = fn;
			}
		}
	}));
	// Non-literal specifier: keeps svelte-check from following cluster.mjs into the build output.
	await import(/* @vite-ignore */ new URL('../../../server/cluster.mjs', import.meta.url).href);
	if (!handler) throw new Error('primary did not register a message handler');
	const relay = handler;
	const origin = { isConnected: () => true, send: vi.fn() };

	return {
		send(message: Record<string, unknown>) {
			relay(origin, { topic: 'thaid-scan-session', ...message });
		},
		/** What a freshly started worker would be told about the relayed sessions. */
		snapshot(): Sent['sessions'] {
			const joiner = { isConnected: () => true, send: vi.fn() };
			relay(joiner, { topic: 'thaid-scan-session', action: 'init' });
			return (joiner.send.mock.calls[0][0] as Sent).sessions;
		}
	};
}

function kioskSession(id: string) {
	const now = Date.now();
	return {
		id,
		kind: 'kiosk_check_in',
		createdAt: now,
		expiresAt: now + 300_000,
		status: 'pending',
		binding: BINDING
	};
}

describe('cluster primary relay of kiosk sessions', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it('does not revive a cancelled session when a stale complete arrives', async () => {
		const primary = await startPrimary();
		primary.send({ action: 'create', session: kioskSession('k1') });
		primary.send({ action: 'cancel', id: 'k1' });

		primary.send({ action: 'complete', id: 'k1', citizen: CITIZEN, expiresAt: Date.now() + 1000 });

		expect(primary.snapshot().map((s) => [s.id, s.status])).toEqual([['k1', 'cancelled']]);
	});

	it('completes a pending session only once and keeps the first citizen', async () => {
		const primary = await startPrimary();
		primary.send({ action: 'create', session: kioskSession('k2') });
		primary.send({ action: 'complete', id: 'k2', citizen: CITIZEN, expiresAt: Date.now() + 1000 });

		primary.send({
			action: 'complete',
			id: 'k2',
			citizen: { pid: '3210987654321', sub: 'sub-2' },
			expiresAt: Date.now() + 2000
		});

		expect(primary.snapshot()).toEqual([
			expect.objectContaining({ id: 'k2', status: 'completed', citizen: CITIZEN })
		]);
	});

	it('follows consume then release, and ignores them out of order', async () => {
		const primary = await startPrimary();
		primary.send({ action: 'create', session: kioskSession('k3') });
		primary.send({ action: 'consume', id: 'k3' }); // still pending
		primary.send({ action: 'release', id: 'k3' }); // not consumed
		expect(primary.snapshot().map((s) => s.status)).toEqual(['pending']);

		primary.send({ action: 'complete', id: 'k3', citizen: CITIZEN, expiresAt: Date.now() + 1000 });
		primary.send({ action: 'release', id: 'k3' }); // completed, not consumed
		primary.send({ action: 'consume', id: 'k3' });
		expect(primary.snapshot().map((s) => s.status)).toEqual(['consumed']);

		primary.send({ action: 'cancel', id: 'k3' }); // consumed cannot be cancelled
		expect(primary.snapshot().map((s) => s.status)).toEqual(['consumed']);
		primary.send({ action: 'release', id: 'k3' });
		expect(primary.snapshot().map((s) => s.status)).toEqual(['completed']);
	});
});
