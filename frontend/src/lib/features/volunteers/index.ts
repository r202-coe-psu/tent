/**
 * Public barrel for the volunteers feature (00-foundation.md §00.5).
 *
 * The ONLY entry point other code may import (`$lib/features/volunteers`) —
 * reaching into `domain/`, `data/`, `application/`, or `ui/` from outside
 * this slice is an ESLint error. Mirrors `referrals/index.ts` /
 * `announcements/index.ts`: domain types/functions, repository factories,
 * and every application-layer hook are re-exported here; nothing internal
 * leaks through.
 */

// domain
export * from './domain/volunteer.schema';
export * from './domain/job.schema';
// `makeJobApplication` is deliberately NOT re-exported: it takes a free-form
// `status`, so exposing it would let callers outside the slice mint a
// `confirmed` application directly and bypass `initialStatusForSkills` (and
// with it the controlled-skill and staff-capable guards). Create applications
// through `jobApplicationRepository().create()` / `useCreateJobApplication`.
export {
	jobApplicationStatusSchema,
	applicantSchema,
	selectedShiftSchema,
	jobApplicationSchema,
	isJobApplication,
	jobApplicationInputSchema,
	JOB_APPLICATION_TRANSITIONS,
	canTransitionJobApplication
} from './domain/job-application.schema';
export type {
	JobApplication,
	JobApplicationInput,
	JobApplicationStatus,
	Applicant,
	SelectedShift
} from './domain/job-application.schema';
export * from './domain/shift-assignment.schema';
export * from './domain/volunteer-transfer.schema';
export * from './domain/quota';
export * from './domain/capacity';
export * from './domain/duty-window';
export * from './domain/collision';
export * from './domain/assign-roster';
export * from './domain/skills';
export * from './domain/applicant-queue';
export * from './domain/shift-roster';
export * from './domain/volunteer-code';
export * from './domain/hub-metrics';

// data — repository interfaces/filters + remote adapter factories
export * from './data/volunteer.repository';
export {
	volunteerRepository,
	volunteerRepositoryFor,
	VolunteerRemoteRepository,
	createVolunteerRepositoryForTest,
	clearVolunteerRepositoryCache
} from './data/volunteer.remote';
export {
	jobRepository,
	JobRemoteRepository,
	createJobRepositoryForTest,
	clearJobRepositoryCache
} from './data/job.remote';
export {
	jobApplicationRepository,
	JobApplicationRemoteRepository,
	createJobApplicationRepositoryForTest
} from './data/job-application.remote';
export {
	shiftAssignmentRepository,
	ShiftAssignmentRemoteRepository,
	createShiftAssignmentRepositoryForTest
} from './data/shift-assignment.remote';
export {
	volunteerTransferRepository,
	VolunteerTransferRemoteRepository,
	createVolunteerTransferRepositoryForTest
} from './data/volunteer-transfer.remote';

// application — query-key factory + every hook
export * from './application/queries';

// ui — Tab 1 (Job Board & Capacity), 01-tab-job-board.md
export { default as VolunteerHubHeader } from './ui/volunteer-hub-header.svelte';
export { default as JobBoardTab } from './ui/job-board-tab.svelte';
export { default as JobCapacitySummary } from './ui/job-capacity-summary.svelte';
export { default as JobFilterChips } from './ui/job-filter-chips.svelte';
export type { JobBoardStatusFilter } from './ui/job-filter-chips.svelte';
export { default as JobCard } from './ui/job-card.svelte';
export { default as JobQuotaBar } from './ui/job-quota-bar.svelte';
export { default as JobFormDialog } from './ui/job-form-dialog.svelte';

// ui — Job detail + shift schedule (01-tab-job-board.md §01.5)
export { default as JobDetailPage } from './ui/job-detail-page.svelte';
export { default as JobDetailHero } from './ui/job-detail-hero.svelte';
export { default as JobDetailOverviewTab } from './ui/job-detail-overview-tab.svelte';
export { default as JobLifecyclePanel } from './ui/job-lifecycle-panel.svelte';
export { default as JobShiftsTab } from './ui/job-shifts-tab.svelte';
export { default as JobShiftCard } from './ui/job-shift-card.svelte';
export { default as JobShiftEditDialog } from './ui/job-shift-edit-dialog.svelte';
export { default as JobShiftRosterDialog } from './ui/job-shift-roster-dialog.svelte';
export { default as JobApplicantsTab } from './ui/job-applicants-tab.svelte';

// ui — Tab 2 (Roster & Live Attendance / ตารางกะและเช็คอิน)
export { default as RosterAttendanceTab } from './ui/roster-attendance-tab.svelte';
export { default as RosterLiveAttendanceBar } from './ui/roster-live-attendance-bar.svelte';
export { default as RosterScanBar } from './ui/roster-scan-bar.svelte';
export { default as RosterRow } from './ui/roster-row.svelte';
export { default as RosterManualCheckinDialog } from './ui/roster-manual-checkin-dialog.svelte';
export { default as RosterAuditTrailDialog } from './ui/roster-audit-trail-dialog.svelte';

// ui — Tab 3 (People / รายชื่อและการอนุมัติ)
export { default as PeopleTab } from './ui/people-tab.svelte';
export { default as VolunteerStatPills } from './ui/volunteer-stat-pills.svelte';
export type { PeopleStatFilter } from './ui/volunteer-stat-pills.svelte';
export { default as VolunteerFilterBar } from './ui/volunteer-filter-bar.svelte';
export { default as VolunteerApprovalChips } from './ui/volunteer-approval-chips.svelte';
export type { ApprovalChip } from './ui/volunteer-approval-chips.svelte';
export { default as VolunteerCard } from './ui/volunteer-card.svelte';
export { default as VolunteerManageDialog } from './ui/volunteer-manage-dialog.svelte';
export { default as VolunteerQualificationsAuditDialog } from './ui/volunteer-qualifications-audit-dialog.svelte';
export { default as VolunteerAccessDialog } from './ui/volunteer-access-dialog.svelte';
export { default as VolunteerTransferDialog } from './ui/volunteer-transfer-dialog.svelte';
export { default as WalkInRegistrationDialog } from './ui/walk-in-registration-dialog.svelte';
export { default as JobAssignPage } from './ui/job-assign-page.svelte';
export { default as AssignRosterRow } from './ui/assign-roster-row.svelte';
export { default as VolunteerSkillMasterPage } from './ui/volunteer-skill-master-page.svelte';
export { default as VolunteerSkillStats } from './ui/volunteer-skill-stats.svelte';
export { default as VolunteerSkillTable } from './ui/volunteer-skill-table.svelte';
export { default as VolunteerSkillEditDialog } from './ui/volunteer-skill-edit-dialog.svelte';
export { default as VolunteerSkillDeleteDialog } from './ui/volunteer-skill-delete-dialog.svelte';
export { default as VolunteerSkillToggleDialog } from './ui/volunteer-skill-toggle-dialog.svelte';
export { default as VolunteerQrScannerModal } from './components/VolunteerQrScannerModal.svelte';
