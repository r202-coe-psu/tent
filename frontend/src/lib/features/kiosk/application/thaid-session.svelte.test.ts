import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { KioskThaidError, type KioskThaidSession } from '../data/kiosk-thaid.api';
import { ThaidSession, type ThaidSessionApi } from './thaid-session.svelte';

const NOW = 1_780_000_000_000;
const SESSION: KioskThaidSession = {
	sessionId: '0123456789abcdef0123456789abcdef',
	qrUrl: 'https://tent.example.go.th/api/v1/auth/oauth/thaid/start?session_id=abc',
	expiresAt: NOW + 180_000,
	expiresInSec: 180
};

/** What the server would answer while still waiting: its TTL counts down on the test's monotonic clock. */
function serverPending(startedAt = performance.now()) {
	return () => ({
		status: 'pending' as const,
		expiresInSec: Math.max(0, 180 - Math.round((performance.now() - startedAt) / 1000))
	});
}

type FakeApi = { [K in keyof ThaidSessionApi]: Mock<ThaidSessionApi[K]> };

function setup(overrides: Partial<FakeApi> = {}) {
	const pending = serverPending();
	const api: FakeApi = {
		create: vi.fn<ThaidSessionApi['create']>().mockResolvedValue(SESSION),
		getStatus: vi.fn<ThaidSessionApi['getStatus']>().mockImplementation(async () => pending()),
		cancel: vi.fn<ThaidSessionApi['cancel']>().mockResolvedValue(undefined),
		...overrides
	};
	return { api, session: new ThaidSession(api) };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ThaidSession start', () => {
	it('creates a session, then waits for the scan with the QR url and expiry', async () => {
		const { api, session } = setup();

		const started = session.start();
		expect(session.state).toBe('creating');
		await started;

		expect(api.create).toHaveBeenCalledTimes(1);
		expect(session.state).toBe('pending');
		expect(session.sessionId).toBe(SESSION.sessionId);
		expect(session.qrUrl).toBe(SESSION.qrUrl);
		expect(session.deadline).toBe(performance.now() + 180_000);
		expect(session.gate).toBeNull();
		session.destroy();
	});
});

describe('ThaidSession server-relative expiry', () => {
	it('stays pending for the server TTL even when the kiosk clock is far ahead of the server', async () => {
		vi.setSystemTime(NOW + 3_600_000);
		const { api, session } = setup();
		await session.start();

		await vi.advanceTimersByTimeAsync(170_000);

		expect(session.state).toBe('pending');
		expect(api.getStatus).toHaveBeenCalled();
		session.destroy();
	});
});

describe('ThaidSession deadline', () => {
	it('falls back to expiresAt against the kiosk clock only when the server sent no expiresInSec', async () => {
		const legacy = {
			sessionId: SESSION.sessionId,
			qrUrl: SESSION.qrUrl,
			expiresAt: SESSION.expiresAt
		};
		const { api, session } = setup({ create: vi.fn().mockResolvedValue(legacy) });
		api.getStatus.mockResolvedValue({ status: 'pending' });
		await session.start();

		await vi.advanceTimersByTimeAsync(170_000);
		expect(session.state).toBe('pending');
		await vi.advanceTimersByTimeAsync(11_000);

		expect(session.state).toBe('expired');
	});

	it('takes the deadline from each status answer', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockResolvedValue({ status: 'pending', expiresInSec: 300 });

		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(200_000);

		expect(session.state).toBe('pending');
		session.destroy();
	});

	it('makes one last status call at the deadline and keeps a confirmation that arrives in the final seconds', async () => {
		const { api, session } = setup({
			create: vi.fn().mockResolvedValue({ ...SESSION, expiresInSec: 181 })
		});
		api.getStatus.mockResolvedValue({ status: 'pending' });
		await session.start();
		await vi.advanceTimersByTimeAsync(180_500);
		expect(session.state).toBe('pending');
		const before = api.getStatus.mock.calls.length;
		api.getStatus.mockResolvedValue({ status: 'completed', expiresInSec: 0 });

		await vi.advanceTimersByTimeAsync(1000);

		expect(api.getStatus).toHaveBeenCalledTimes(before + 1);
		expect(session.state).toBe('completed');
		expect(session.gate).toEqual({ source: 'thaid', session_id: SESSION.sessionId });
		session.destroy();
	});

	it('expires after the last status call still says pending, and a failing last call also expires', async () => {
		const first = setup();
		await first.session.start();
		await vi.advanceTimersByTimeAsync(181_000);
		expect(first.session.state).toBe('expired');
		const calls = first.api.getStatus.mock.calls.length;
		await vi.advanceTimersByTimeAsync(20_000);
		expect(first.api.getStatus).toHaveBeenCalledTimes(calls);

		const second = setup({
			create: vi.fn().mockResolvedValue({ ...SESSION, expiresInSec: 1 })
		});
		await second.session.start();
		second.api.getStatus.mockRejectedValue(new KioskThaidError(0, 'TIMEOUT'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(second.session.state).toBe('expired');
	});
});

describe('ThaidSession polling', () => {
	it('polls the status every 2 seconds and exposes the gate once the phone has confirmed', async () => {
		const { api, session } = setup();
		await session.start();
		expect(api.getStatus).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(api.getStatus).toHaveBeenCalledTimes(1);
		expect(api.getStatus).toHaveBeenLastCalledWith(SESSION.sessionId);
		expect(session.state).toBe('pending');

		api.getStatus.mockResolvedValue({ status: 'completed', expiresAt: SESSION.expiresAt });
		await vi.advanceTimersByTimeAsync(2000);

		expect(session.state).toBe('completed');
		expect(session.gate).toEqual({ source: 'thaid', session_id: SESSION.sessionId });

		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).toHaveBeenCalledTimes(2);
		session.destroy();
	});
});

describe('ThaidSession ending without a scan', () => {
	it('stops polling when the server says the session expired', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockResolvedValue({ status: 'expired' });

		await vi.advanceTimersByTimeAsync(2000);
		expect(session.state).toBe('expired');
		expect(session.gate).toBeNull();

		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).toHaveBeenCalledTimes(1);
		session.destroy();
	});

	it('expires on the local clock once the deadline has passed, without polling any more', async () => {
		const { api, session } = setup();
		await session.start();

		await vi.advanceTimersByTimeAsync(180_000);
		expect(session.state).toBe('expired');
		const calls = api.getStatus.mock.calls.length;

		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).toHaveBeenCalledTimes(calls);
		session.destroy();
	});

	it('ends as cancelled when another QR replaced this session', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockResolvedValue({ status: 'cancelled', expiresAt: SESSION.expiresAt });

		await vi.advanceTimersByTimeAsync(2000);
		expect(session.state).toBe('cancelled');

		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).toHaveBeenCalledTimes(1);
		session.destroy();
	});

	it('treats a consumed session as expired: it can no longer be used', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockResolvedValue({ status: 'consumed', expiresAt: SESSION.expiresAt });

		await vi.advanceTimersByTimeAsync(2000);
		expect(session.state).toBe('expired');
		session.destroy();
	});
});

describe('ThaidSession resilience', () => {
	it('never overlaps polls: the next one waits until the slow one has answered', async () => {
		let release!: (value: { status: 'pending'; expiresAt: number }) => void;
		const { api, session } = setup();
		api.getStatus.mockImplementationOnce(
			() => new Promise((resolve) => (release = resolve as typeof release))
		);
		await session.start();

		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(6000);
		expect(api.getStatus).toHaveBeenCalledTimes(1);

		release({ status: 'pending', expiresAt: SESSION.expiresAt });
		await vi.advanceTimersByTimeAsync(2000);
		expect(api.getStatus).toHaveBeenCalledTimes(2);
		session.destroy();
	});

	it('keeps polling through a transient network failure', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockRejectedValueOnce(new KioskThaidError(0, 'TIMEOUT'));

		await vi.advanceTimersByTimeAsync(2000);
		expect(session.state).toBe('pending');
		api.getStatus.mockResolvedValue({ status: 'completed', expiresAt: SESSION.expiresAt });
		await vi.advanceTimersByTimeAsync(2000);

		expect(session.state).toBe('completed');
		session.destroy();
	});

	it.each([
		['a 500', new KioskThaidError(500, 'INTERNAL')],
		['a 429', new KioskThaidError(429, 'KIOSK_RATE_LIMITED', 5)],
		['a network error', new TypeError('Failed to fetch')]
	])('keeps polling after %s', async (_name, failure) => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockRejectedValueOnce(failure);

		await vi.advanceTimersByTimeAsync(2000);
		expect(session.state).toBe('pending');
		await vi.advanceTimersByTimeAsync(2000);

		expect(api.getStatus).toHaveBeenCalledTimes(2);
		session.destroy();
	});

	it.each([
		[new KioskThaidError(400, 'INVALID_INPUT'), 'invalid'],
		[new KioskThaidError(401, 'DEVICE_AUTH_FAILED'), 'unauthorized'],
		[new KioskThaidError(403, 'KIOSK_METHOD_DISABLED'), 'disabled']
	])('treats %s while polling as final: error state, no more polls', async (failure, kind) => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockRejectedValueOnce(failure);

		await vi.advanceTimersByTimeAsync(2000);

		expect(session.state).toBe('error');
		expect(session.errorKind).toBe(kind);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(api.getStatus).toHaveBeenCalledTimes(1);
		session.destroy();
	});

	it.each([
		[new KioskThaidError(403, 'KIOSK_METHOD_DISABLED'), 'disabled', null],
		[new KioskThaidError(429, 'KIOSK_RATE_LIMITED', 30), 'rate_limited', 30],
		[new KioskThaidError(503, 'DEPENDENCY_UNAVAILABLE'), 'unavailable', null],
		[new TypeError('Failed to fetch'), 'unavailable', null]
	])(
		'ends in the error state when creating the session fails (%s)',
		async (failure, kind, retry) => {
			const { api, session } = setup({ create: vi.fn().mockRejectedValue(failure) });

			await session.start();

			expect(session.state).toBe('error');
			expect(session.errorKind).toBe(kind);
			expect(session.retryAfterSeconds).toBe(retry);
			expect(session.qrUrl).toBeNull();
			await vi.advanceTimersByTimeAsync(10_000);
			expect(api.getStatus).not.toHaveBeenCalled();
		}
	);
});

describe('ThaidSession destroy', () => {
	it('stops polling and cancels a session that is still waiting for the scan', async () => {
		const { api, session } = setup();
		await session.start();

		session.destroy();

		expect(api.cancel).toHaveBeenCalledTimes(1);
		expect(api.cancel).toHaveBeenCalledWith(SESSION.sessionId);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).not.toHaveBeenCalled();
		expect(session.state).toBe('pending');
	});

	it('also cancels a completed session so leaving the page burns it', async () => {
		const { api, session } = setup();
		await session.start();
		api.getStatus.mockResolvedValue({ status: 'completed', expiresAt: SESSION.expiresAt });
		await vi.advanceTimersByTimeAsync(2000);

		session.destroy();

		expect(api.cancel).toHaveBeenCalledWith(SESSION.sessionId);
	});

	it.each(['expired', 'cancelled'] as const)(
		'does not cancel a session the server already ended (%s)',
		async (status) => {
			const { api, session } = setup();
			await session.start();
			api.getStatus.mockResolvedValue({ status });
			await vi.advanceTimersByTimeAsync(2000);

			session.destroy();

			expect(api.cancel).not.toHaveBeenCalled();
		}
	);

	it('cancels a session whose creation finishes after the page was left', async () => {
		let create!: (value: KioskThaidSession) => void;
		const { api, session } = setup({
			create: vi.fn(() => new Promise<KioskThaidSession>((resolve) => (create = resolve)))
		});
		const started = session.start();

		session.destroy();
		create(SESSION);
		await started;

		expect(api.cancel).toHaveBeenCalledWith(SESSION.sessionId);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(api.getStatus).not.toHaveBeenCalled();
	});
});

describe('ThaidSession restart', () => {
	it('creates a new session after the QR expired', async () => {
		const { api, session } = setup();
		await session.start();
		await vi.advanceTimersByTimeAsync(180_000);
		expect(session.state).toBe('expired');
		const fresh = {
			sessionId: 'fedcba9876543210fedcba9876543210',
			qrUrl: 'https://tent.example.go.th/start?session_id=new',
			expiresAt: Date.now() + 180_000
		};
		api.create.mockResolvedValueOnce(fresh);

		await session.restart();

		expect(session.state).toBe('pending');
		expect(session.sessionId).toBe(fresh.sessionId);
		expect(session.qrUrl).toBe(fresh.qrUrl);
		expect(session.deadline).toBe(performance.now() + 180_000);
		expect(api.cancel).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2000);
		expect(api.getStatus).toHaveBeenLastCalledWith(fresh.sessionId);
		session.destroy();
	});

	it('cancels the session it replaces when that one is still waiting, and ignores its late answer', async () => {
		let release!: (value: { status: 'completed'; expiresAt: number }) => void;
		const { api, session } = setup();
		api.getStatus.mockImplementationOnce(
			() => new Promise((resolve) => (release = resolve as typeof release))
		);
		await session.start();
		await vi.advanceTimersByTimeAsync(2000);
		api.create.mockResolvedValueOnce({ ...SESSION, sessionId: 'fedcba9876543210fedcba9876543210' });

		await session.restart();
		release({ status: 'completed', expiresAt: SESSION.expiresAt });
		await vi.advanceTimersByTimeAsync(0);

		expect(api.cancel).toHaveBeenCalledWith(SESSION.sessionId);
		expect(session.state).toBe('pending');
		expect(session.gate).toBeNull();
		session.destroy();
	});
});
