import { AUDIT_ACTIONS, type AuditAction } from './audit-event';
import type { AuditLogFilters } from './audit-query';

export type AuditFilterForm = {
	entity_type: string;
	action: string;
	actor: string;
	from_date: string;
	to_date: string;
	shelter_code: string;
};

export const EMPTY_AUDIT_FILTER_FORM: AuditFilterForm = {
	entity_type: '',
	action: '',
	actor: '',
	from_date: '',
	to_date: '',
	shelter_code: ''
};

const FORM_KEYS = Object.keys(EMPTY_AUDIT_FILTER_FORM) as Array<keyof AuditFilterForm>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function auditFilterFormFromParams(params: URLSearchParams): AuditFilterForm {
	const form = { ...EMPTY_AUDIT_FILTER_FORM };
	for (const key of FORM_KEYS) form[key] = params.get(key)?.trim() ?? '';
	if (!(AUDIT_ACTIONS as readonly string[]).includes(form.action)) form.action = '';
	if (!DATE.test(form.from_date)) form.from_date = '';
	if (!DATE.test(form.to_date)) form.to_date = '';
	return form;
}

export function auditFilterFormToParams(form: AuditFilterForm): URLSearchParams {
	const params = new URLSearchParams();
	for (const key of FORM_KEYS) {
		const value = form[key].trim();
		if (value) params.set(key, value);
	}
	return params;
}

export function auditFiltersFromForm(
	form: AuditFilterForm,
	forcedShelterCode: string | null
): AuditLogFilters {
	return {
		entity_type: form.entity_type || undefined,
		action: (form.action || undefined) as AuditAction | undefined,
		actor: form.actor.trim() || undefined,
		from: form.from_date ? new Date(`${form.from_date}T00:00:00+07:00`).toISOString() : undefined,
		to: form.to_date ? new Date(`${form.to_date}T23:59:59.999+07:00`).toISOString() : undefined,
		shelter_code: forcedShelterCode ?? (form.shelter_code.trim() || undefined)
	};
}
