import { authStore } from '$lib/stores/auth.svelte';
import { getShelterCode } from '$lib/db/shelter';
import type { IncidentSeverity, IncidentStatus } from '../domain/incident';
import type { IncidentActor } from '../domain/incident.policy';

/** 360° tinted badge classes (civic design system) — always rendered with a text label. */
export const STATUS_BADGE_CLASS: Record<IncidentStatus, string> = {
	reported: 'border-sky-200 bg-sky-50 text-sky-900',
	action_in_progress: 'border-amber-200 bg-amber-50 text-amber-900',
	resolved: 'border-emerald-200 bg-emerald-50 text-emerald-900',
	closed: 'border-slate-200 bg-slate-100 text-slate-700',
	cancelled: 'border-slate-200 bg-slate-100 text-slate-500 line-through'
};

export const SEVERITY_BADGE_CLASS: Record<IncidentSeverity, string> = {
	low: 'border-slate-200 bg-slate-50 text-slate-700',
	medium: 'border-sky-200 bg-sky-50 text-sky-900',
	high: 'border-amber-200 bg-amber-50 text-amber-900',
	critical: 'border-red-200 bg-red-50 text-red-900'
};

const DATE_TIME = new Intl.DateTimeFormat('th-TH', {
	timeZone: 'Asia/Bangkok',
	dateStyle: 'medium',
	timeStyle: 'short'
});

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d);
}

/** `datetime-local` value (Bangkok wall clock) for now. */
export function nowLocalInput(): string {
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date());
	return parts.replace(' ', 'T');
}

/** Interpret a `datetime-local` value as Bangkok time (UTC+7, no DST) → ISO UTC. */
export function localInputToIso(value: string): string {
	return new Date(`${value}:00+07:00`).toISOString();
}

/** The signed-in user as an incident actor in the active shelter. */
export function currentIncidentActor(): IncidentActor {
	return {
		name: authStore.user?.name ?? '',
		roles: authStore.user?.roles ?? [],
		shelterCode: getShelterCode()
	};
}

/** Which timeline-producing action the action dialog is collecting. */
export type ActionMode =
	| { kind: 'status'; to: IncidentStatus }
	| { kind: 'reassign' }
	| { kind: 'note' }
	| { kind: 'identify' };
