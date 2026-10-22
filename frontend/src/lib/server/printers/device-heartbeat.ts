import type { PrintDeviceDoc } from './device-credentials';

export type PrintDeviceWriteResult = { ok: true; rev: string } | { conflict: true };

export interface PrintDeviceWriter {
	updateDevice(doc: PrintDeviceDoc): Promise<PrintDeviceWriteResult>;
}

export interface Heartbeat {
	queue_state: PrintDeviceDoc['queue_state'];
	agent_version?: string;
	now: Date;
	/** Write even when nothing changed (hello). */
	force?: boolean;
}

/** A `last_seen_at` older than this is refreshed even when nothing else changed. */
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Throttled `last_seen_at` / `queue_state` / `agent_version` write (plan §4.1): at most one write
 * per 20 s unless the reported state changed (or `force`). A conflict means another request
 * already refreshed the doc, so it is dropped — the next poll retries.
 */
export async function recordHeartbeat(
	repo: PrintDeviceWriter,
	device: PrintDeviceDoc,
	heartbeat: Heartbeat
): Promise<void> {
	const { queue_state, agent_version, now, force } = heartbeat;
	const stateChanged =
		queue_state !== device.queue_state ||
		(agent_version !== undefined && agent_version !== device.agent_version);
	const due =
		device.last_seen_at === null ||
		now.getTime() - Date.parse(device.last_seen_at) >= HEARTBEAT_INTERVAL_MS;
	if (!force && !stateChanged && !due) return;

	await repo.updateDevice({
		...device,
		last_seen_at: now.toISOString(),
		queue_state,
		agent_version: agent_version ?? device.agent_version
	});
}
