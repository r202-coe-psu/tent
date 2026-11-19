import { adminRaw, ServiceError } from './couch-admin';
import { ulid } from '$lib/db/ulid';
import type { Zone } from '$lib/features/shelters/server';
import { nowIso, updateMaster } from './shelters.admin';
import { recordAuditedWrite } from './audit-log';
import { AUDIT_EVENTS } from '$lib/features/audit-log/server';

export type ZoneTransition = 'close' | 'reopen';

type TransitionSpec = {
	nextStatus: Zone['status'];
	blockedWhen: Zone['status'];
	blockedMessage: (zoneCode: string) => string;
	legacyAction: string;
	event: string;
};

const SPECS: Record<ZoneTransition, TransitionSpec> = {
	close: {
		nextStatus: 'closed',
		blockedWhen: 'closed',
		blockedMessage: (zoneCode) => `Zone "${zoneCode}" is already closed`,
		legacyAction: 'zone.close',
		event: AUDIT_EVENTS.shelterZoneClosed
	},
	reopen: {
		nextStatus: 'active',
		blockedWhen: 'active',
		blockedMessage: (zoneCode) => `Zone "${zoneCode}" is already active`,
		legacyAction: 'zone.reopen',
		event: AUDIT_EVENTS.shelterZoneReopened
	}
};

export type ZoneTransitionResult = { updatedZone: Zone } | { lost: true };

export async function applyZoneTransition(
	transition: ZoneTransition,
	options: { code: string; zoneCode: string; actor: string; reason?: string | null }
): Promise<ZoneTransitionResult> {
	const { code, zoneCode, actor } = options;
	const reason = options.reason ?? null;
	const spec = SPECS[transition];

	const { meta, before, after } = await updateMaster<{
		updatedZone: Zone;
		previousStatus: string;
	}>(code, actor, (current) => {
		const zones = current.zones ?? [];
		const zoneIndex = zones.findIndex((z) => z.code === zoneCode);
		if (zoneIndex === -1) {
			throw new ServiceError('VALIDATION', `Zone "${zoneCode}" not found in shelter ${code}`);
		}
		const target = zones[zoneIndex];
		if (target.status === spec.blockedWhen) {
			throw new ServiceError('CONFLICT', spec.blockedMessage(zoneCode));
		}
		const stamp = nowIso();
		const updatedZone: Zone =
			transition === 'close'
				? {
						...target,
						status: spec.nextStatus,
						closed_at: stamp,
						closed_by: actor,
						reopened_at: null,
						reopened_by: null,
						reason
					}
				: {
						...target,
						status: spec.nextStatus,
						closed_at: null,
						closed_by: null,
						reopened_at: stamp,
						reopened_by: actor,
						reason: null
					};
		return {
			patch: { zones: zones.map((z, i) => (i === zoneIndex ? updatedZone : z)) },
			meta: { updatedZone, previousStatus: target.status }
		};
	});

	if (!meta) return { lost: true };

	const auditDoc = {
		_id: `audit:${ulid()}`,
		type: 'audit',
		schema_v: 1,
		shelter_code: code,
		action: spec.legacyAction,
		target_type: 'shelter_zone',
		target_id: `${code}:${zoneCode}`,
		reason: reason ?? '',
		context: { zone_code: zoneCode, previous_status: meta.previousStatus, actor },
		occurred_at: nowIso()
	};
	await adminRaw(`/registry/${encodeURIComponent(auditDoc._id)}`, 'PUT', auditDoc);
	await recordAuditedWrite({
		actor,
		event: spec.event,
		action: 'status_change',
		entityType: 'shelter',
		entityId: code,
		label: after?.name ?? null,
		shelterCode: code,
		before: before as Record<string, unknown> | undefined,
		after: after as Record<string, unknown> | undefined,
		reason: reason ? `${zoneCode}: ${reason}` : zoneCode
	});

	return { updatedZone: meta.updatedZone };
}
