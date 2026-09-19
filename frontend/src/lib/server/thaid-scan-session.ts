import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

export type ScanSessionStatus = 'pending' | 'completed' | 'expired';

export interface ScanSession {
	id: string;
	createdAt: number;
	expiresAt: number; // Unix ms
	status: ScanSessionStatus;
	profile?: ThaiDAutofillProfile;
	emitter: EventEmitter;
}

// In-memory store for active scan sessions
const sessions = new Map<string, ScanSession>();

// Cleanup timer running every 30 seconds
let cleanupInterval: NodeJS.Timeout | null = null;

function ensureCleanupInterval() {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		cleanupExpiredSessions();
	}, 30_000);
	if (cleanupInterval.unref) {
		cleanupInterval.unref();
	}
}

export function cleanupExpiredSessions(now: number = Date.now()): void {
	for (const [id, session] of sessions.entries()) {
		if (session.expiresAt <= now) {
			if (session.status === 'pending') {
				session.status = 'expired';
				session.emitter.emit('expired');
			}
			sessions.delete(id);
		}
	}
}

export function createScanSession(ttlSeconds: number = 300): ScanSession {
	ensureCleanupInterval();
	const id = randomBytes(16).toString('hex');
	const now = Date.now();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(30);

	const session: ScanSession = {
		id,
		createdAt: now,
		expiresAt: now + ttlSeconds * 1000,
		status: 'pending',
		emitter
	};

	sessions.set(id, session);
	return session;
}

export function getScanSession(id: string): ScanSession | null {
	const session = sessions.get(id);
	if (!session) return null;
	if (session.expiresAt <= Date.now()) {
		if (session.status === 'pending') {
			session.status = 'expired';
			session.emitter.emit('expired');
		}
		sessions.delete(id);
		return null;
	}
	return session;
}

export function completeScanSession(id: string, profile: ThaiDAutofillProfile): boolean {
	const session = getScanSession(id);
	if (!session || session.status !== 'pending') return false;

	session.status = 'completed';
	session.profile = profile;
	session.emitter.emit('completed', profile);
	return true;
}

/** Clear all sessions (primarily for unit tests). */
export function _resetSessionsForTest(): void {
	sessions.clear();
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}
