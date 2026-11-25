import { serviceFetch } from '$lib/api/service';
import {
	auditLogSearchParams,
	type AuditLogFilters,
	type AuditLogPage
} from '../domain/audit-query';

const AUDIT_LOG_ENDPOINT = '/api/back-office/audit-log';

export function fetchAuditLog(filters: AuditLogFilters): Promise<AuditLogPage> {
	const params = auditLogSearchParams(filters).toString();
	return serviceFetch<AuditLogPage>(
		params ? `${AUDIT_LOG_ENDPOINT}?${params}` : AUDIT_LOG_ENDPOINT,
		{
			cache: 'no-store'
		}
	);
}
