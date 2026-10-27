/**
 * Everything the public (no-account) volunteer surfaces need — CR-092 หน้าจอ 1, 2 และ 6:
 * the Job Board and its no-auth application form, the Digital Pass, and the Access
 * Portal where a volunteer signs in with their phone number to read ตารางทำงานจิตอาสา
 * and answer offered shifts.
 *
 * Reads and writes go through the BFF `/api/public/v1/volunteer/*` only — never straight
 * to FastAPI (CR-063) and never to CouchDB. The staff-side slice for the same domain is
 * `$lib/features/volunteers`; the two share no code by design, because one is projected
 * public data and the other is the system of record.
 *
 * The only entry point other code may import.
 */
export {
	DISPATCH_STATUSES,
	SHIFT_STATUSES,
	dispatchRespondSchema,
	responseCodeSchema,
	TICKET_STATUSES,
	isJobApplicable,
	isUpcomingShift,
	normalizeTicketToken,
	PORTAL_TOKEN_HANDOFF_KEY,
	PORTAL_SESSION_KEY,
	portalCredentialSchema,
	ticketTokenFromScan,
	isValidThaiNationalId,
	needsDispatchResponse,
	shiftStatusLabel,
	ticketFindSchema,
	ticketStatusLabel,
	volunteerApplySchema,
	volunteerProfileUpdateSchema
} from './domain/volunteer';
export { hasOpenShift, isShiftOpen, openJobsFirst, openShifts } from './domain/shift-closing';
export type { ClosableShift } from './domain/shift-closing';
export type {
	DispatchRespondInput,
	DispatchStatus,
	JobShiftTemplate,
	PortalCredential,
	PublicJobFilter,
	ScheduleShift,
	ShiftStatus,
	PublicJob,
	TicketFindInput,
	TicketShift,
	TicketStatus,
	TicketSummary,
	VolunteerApplyInput,
	VolunteerProfile,
	VolunteerSkillOption,
	VolunteerProfileUpdateInput,
	VolunteerTicket
} from './domain/volunteer';

export { summarizeUrgentVolunteerNeed } from './domain/urgent-need';
export type { UrgentShelterNeed, UrgentVolunteerNeed } from './domain/urgent-need';

export {
	useApplyToJobMutation,
	useUpdateProfileMutation,
	useVolunteerProfile,
	useResolvePortalAccessMutation,
	useVolunteerSkills,
	useCancelTicketMutation,
	useFindTicketsMutation,
	useVolunteerJobs,
	useRespondToDispatchMutation,
	useVolunteerSchedule,
	useVolunteerTicket,
	useVolunteerTickets,
	volunteerPortalKeys
} from './application/queries';

export { default as TicketFinder } from './ui/ticket-finder.svelte';
export { ticketI18n } from './i18n/ticket.i18n';
export { default as DigitalPass } from './ui/digital-pass.svelte';
export { default as VolunteerAccessPortal } from './ui/volunteer-access-portal.svelte';
