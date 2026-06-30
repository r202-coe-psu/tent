/**
 * Public API barrel for the dashboard-registration feature.
 */
export type { RegistrationsPayload, RegistrationsQuery } from './domain/schema';
export {
	RegistrationsPayloadSchema,
	RegistrationsQuerySchema,
	rowsToRegistrationsPayload,
	defaultDateRange
} from './domain/schema';
export { fetchRegistrations } from './data/registration.api';
