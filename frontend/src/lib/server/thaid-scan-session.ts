import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { ThaiDAutofillProfile } from '$lib/features/people';

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

interface ClusterSessionPayload {
	id: string;
	createdAt: number;
	expiresAt: number;
	status: ScanSessionStatus;
	profile?: ThaiDAutofillProfile;
}

interface ClusterMessage {
	topic: 'thaid-scan-session';
	action: 'create' | 'complete' | 'expire' | 'init' | 'init_sync';
	session?: ClusterSessionPayload;
	sessions?: ClusterSessionPayload[];
	id?: string;
	profile?: ThaiDAutofillProfile;
}

function broadcastCluster(msg: Omit<ClusterMessage, 'topic'>) {
	if (typeof process !== 'undefined' && typeof process.send === 'function') {
		try {
			process.send({ topic: 'thaid-scan-session', ...msg });
		} catch {
			// ignore if IPC channel is closed or unsupported
		}
	}
}

function handleClusterMessage(msg: unknown) {
	if (!msg || typeof msg !== 'object') return;
	const m = msg as Partial<ClusterMessage>;
	if (m.topic !== 'thaid-scan-session') return;

	if (m.action === 'create' && m.session) {
		if (!sessions.has(m.session.id)) {
			const emitter = new EventEmitter();
			emitter.setMaxListeners(30);
			sessions.set(m.session.id, {
				...m.session,
				emitter
			});
		}
	} else if (m.action === 'complete' && m.id && m.profile) {
		const session = sessions.get(m.id);
		if (session && session.status === 'pending') {
			session.status = 'completed';
			session.profile = m.profile;
			session.emitter.emit('completed', m.profile);
		}
	} else if (m.action === 'expire' && m.id) {
		const session = sessions.get(m.id);
		if (session) {
			if (session.status === 'pending') {
				session.status = 'expired';
				session.emitter.emit('expired');
			}
			sessions.delete(m.id);
		}
	} else if (m.action === 'init_sync' && Array.isArray(m.sessions)) {
		const now = Date.now();
		for (const s of m.sessions) {
			if (s.expiresAt > now && !sessions.has(s.id)) {
				const emitter = new EventEmitter();
				emitter.setMaxListeners(30);
				sessions.set(s.id, {
					...s,
					emitter
				});
			}
		}
	} else if (m.action === 'init') {
		const activeSessions: ClusterSessionPayload[] = [];
		const now = Date.now();
		for (const s of sessions.values()) {
			if (s.expiresAt > now && s.status === 'pending') {
				activeSessions.push({
					id: s.id,
					createdAt: s.createdAt,
					expiresAt: s.expiresAt,
					status: s.status,
					profile: s.profile
				});
			}
		}
		if (activeSessions.length > 0) {
			broadcastCluster({ action: 'init_sync', sessions: activeSessions });
		}
	}
}

if (typeof process !== 'undefined' && typeof process.on === 'function') {
	process.on('message', handleClusterMessage);
	broadcastCluster({ action: 'init' });
}

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
			broadcastCluster({ action: 'expire', id });
		}
	}
}

export function createScanSession(ttlSeconds: number = 900): ScanSession {
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
	broadcastCluster({
		action: 'create',
		session: {
			id: session.id,
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			status: session.status
		}
	});
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
		broadcastCluster({ action: 'expire', id });
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
	broadcastCluster({ action: 'complete', id, profile });
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
