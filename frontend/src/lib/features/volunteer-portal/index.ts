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
	SHIFT_STATUSES,
	TICKET_STATUSES,
	isJobApplicable,
	isUpcomingShift,
	normalizeTicketToken,
	PORTAL_TOKEN_HANDOFF_KEY,
	portalCredentialSchema,
	ticketTokenFromScan,
	isValidThaiNationalId,
	personnelTypeLabel,
	shiftStatusLabel,
	ticketFindSchema,
	ticketStatusLabel,
	volunteerApplySchema,
	volunteerProfileUpdateSchema
} from './domain/volunteer';
export type {
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

export {
	useApplyToJobMutation,
	useUpdateProfileMutation,
	useVolunteerProfile,
	useVolunteerSkills,
	useCancelTicketMutation,
	useFindTicketsMutation,
	useVolunteerJobs,
	useVolunteerSchedule,
	useVolunteerTicket,
	useVolunteerTickets,
	volunteerPortalKeys
} from './application/queries';

export { default as TicketFinder } from './ui/ticket-finder.svelte';
export { default as JobBoard } from './ui/job-board.svelte';
export { default as DigitalPass } from './ui/digital-pass.svelte';
export { default as VolunteerAccessPortal } from './ui/volunteer-access-portal.svelte';
