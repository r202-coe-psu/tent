import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { ThaiDAutofillProfile } from '$lib/features/people';

export type ScanSessionStatus = 'pending' | 'completed' | 'expired' | 'cancelled' | 'consumed';
export type ScanSessionKind = 'member_scan' | 'kiosk_check_in';

/** Kiosk that created a `kiosk_check_in` session; only that device may read or use it. */
export interface KioskSessionBinding {
	device_id: string;
	shelter_code: string;
}

/** Verified ThaiD identity of a kiosk check-in; server-only, never sent to a browser. */
export interface KioskCitizen {
	pid: string;
	sub: string;
}

export interface ScanSession {
	id: string;
	kind: ScanSessionKind;
	createdAt: number;
	expiresAt: number; // Unix ms
	status: ScanSessionStatus;
	profile?: ThaiDAutofillProfile;
	citizen?: KioskCitizen;
	binding?: KioskSessionBinding;
	emitter: EventEmitter;
}

/** Proposed in draft-kiosk-thaid-check-in D-4 (pending PO decision). */
export const KIOSK_THAID_PENDING_TTL_SEC = 300;
/** Proposed in draft-kiosk-thaid-check-in D-4 (pending PO decision). */
export const KIOSK_THAID_COMPLETED_TTL_SEC = 180;

// In-memory store for active scan sessions
const sessions = new Map<string, ScanSession>();

// Cleanup timer running every 30 seconds
let cleanupInterval: NodeJS.Timeout | null = null;

interface ClusterSessionPayload {
	id: string;
	kind?: ScanSessionKind;
	createdAt: number;
	expiresAt: number;
	status: ScanSessionStatus;
	profile?: ThaiDAutofillProfile;
	citizen?: KioskCitizen;
	binding?: KioskSessionBinding;
}

interface ClusterMessage {
	topic: 'thaid-scan-session';
	action: 'create' | 'complete' | 'cancel' | 'consume' | 'expire' | 'init' | 'init_sync';
	session?: ClusterSessionPayload;
	sessions?: ClusterSessionPayload[];
	id?: string;
	profile?: ThaiDAutofillProfile;
	citizen?: KioskCitizen;
	/** New expiry carried by a kiosk `complete` (the completed-TTL window). */
	expiresAt?: number;
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
				kind: m.session.kind ?? 'member_scan',
				emitter
			});
		}
	} else if (m.action === 'complete' && m.id && m.citizen) {
		const session = sessions.get(m.id);
		if (session && session.kind === 'kiosk_check_in' && session.status === 'pending') {
			session.status = 'completed';
			session.citizen = m.citizen;
			if (m.expiresAt) session.expiresAt = m.expiresAt;
			session.emitter.emit('completed');
		}
	} else if (m.action === 'complete' && m.id && m.profile) {
		const session = sessions.get(m.id);
		if (session && session.kind === 'member_scan' && session.status === 'pending') {
			session.status = 'completed';
			session.profile = m.profile;
			session.emitter.emit('completed', m.profile);
		}
	} else if (m.action === 'cancel' && m.id) {
		const session = sessions.get(m.id);
		const cancellable = session?.status === 'pending' || session?.status === 'completed';
		if (session && session.kind === 'kiosk_check_in' && cancellable) {
			session.status = 'cancelled';
			session.emitter.emit('cancelled');
		}
	} else if (m.action === 'consume' && m.id) {
		const session = sessions.get(m.id);
		if (session && session.kind === 'kiosk_check_in' && session.status === 'completed') {
			session.status = 'consumed';
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
					kind: s.kind ?? 'member_scan',
					emitter
				});
			}
		}
	} else if (m.action === 'init') {
		const activeSessions: ClusterSessionPayload[] = [];
		const now = Date.now();
		for (const s of sessions.values()) {
			const shareable = s.kind === 'kiosk_check_in' || s.status === 'pending';
			if (s.expiresAt > now && shareable) {
				activeSessions.push({
					id: s.id,
					kind: s.kind,
					createdAt: s.createdAt,
					expiresAt: s.expiresAt,
					status: s.status,
					profile: s.profile,
					citizen: s.citizen,
					binding: s.binding
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

function createSession(
	kind: ScanSessionKind,
	ttlSeconds: number,
	binding?: KioskSessionBinding
): ScanSession {
	ensureCleanupInterval();
	const id = randomBytes(16).toString('hex');
	const now = Date.now();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(30);

	const session: ScanSession = {
		id,
		kind,
		createdAt: now,
		expiresAt: now + ttlSeconds * 1000,
		status: 'pending',
		binding,
		emitter
	};

	sessions.set(id, session);
	broadcastCluster({
		action: 'create',
		session: {
			id: session.id,
			kind: session.kind,
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			status: session.status,
			binding: session.binding
		}
	});
	return session;
}

export function createScanSession(ttlSeconds: number = 900): ScanSession {
	return createSession('member_scan', ttlSeconds);
}

export function createKioskCheckInSession(binding: KioskSessionBinding): ScanSession {
	// One active session per kiosk: a new QR supersedes the device's pending one.
	for (const existing of [...sessions.values()]) {
		if (
			existing.kind === 'kiosk_check_in' &&
			existing.status === 'pending' &&
			existing.binding?.device_id === binding.device_id
		) {
			cancelKioskSession(existing.id, binding.device_id);
		}
	}
	return createSession('kiosk_check_in', KIOSK_THAID_PENDING_TTL_SEC, { ...binding });
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

/** Kiosk session owned by `deviceId`; null when missing, expired, another kind or another device. */
export function getKioskSessionForDevice(id: string, deviceId: string): ScanSession | null {
	const session = getScanSession(id);
	if (!session || session.kind !== 'kiosk_check_in') return null;
	if (session.binding?.device_id !== deviceId) return null;
	return session;
}

export function completeScanSession(id: string, profile: ThaiDAutofillProfile): boolean {
	const session = getScanSession(id);
	if (!session || session.kind !== 'member_scan' || session.status !== 'pending') return false;

	session.status = 'completed';
	session.profile = profile;
	session.emitter.emit('completed', profile);
	broadcastCluster({ action: 'complete', id, profile });
	return true;
}

/** Marks a pending kiosk session completed with the verified citizen (single-use window). */
export function completeKioskSession(id: string, citizen: KioskCitizen): boolean {
	const session = getScanSession(id);
	if (!session || session.kind !== 'kiosk_check_in' || session.status !== 'pending') return false;

	session.status = 'completed';
	session.citizen = { ...citizen };
	session.expiresAt = Date.now() + KIOSK_THAID_COMPLETED_TTL_SEC * 1000;
	session.emitter.emit('completed');
	broadcastCluster({
		action: 'complete',
		id,
		citizen: session.citizen,
		expiresAt: session.expiresAt
	});
	return true;
}

/** Single-use read of the verified citizen: completed + owning device only, then `consumed`. */
export function consumeKioskSession(id: string, deviceId: string): KioskCitizen | null {
	const session = getKioskSessionForDevice(id, deviceId);
	if (!session || session.status !== 'completed' || !session.citizen) return null;

	session.status = 'consumed';
	broadcastCluster({ action: 'consume', id });
	return session.citizen;
}

/** Idempotent; pending or completed session of this device becomes `cancelled`. */
export function cancelKioskSession(id: string, deviceId: string): void {
	const session = getKioskSessionForDevice(id, deviceId);
	if (!session || (session.status !== 'pending' && session.status !== 'completed')) return;

	session.status = 'cancelled';
	session.emitter.emit('cancelled');
	broadcastCluster({ action: 'cancel', id });
}

/** Clear all sessions (primarily for unit tests). */
export function _resetSessionsForTest(): void {
	sessions.clear();
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}
