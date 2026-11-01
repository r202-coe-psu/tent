<script lang="ts">
	/**
	 * One applicant block of the job detail "ผู้สมัคร (Applicants & Queue)" tab
	 * (approved mockup 2026-08-30).
	 *
	 * One person, one card (#716): `applications` are that applicant's applications for this
	 * job — one per shift. A pending card with several shifts gets "อนุมัติทุกกะ" plus an
	 * approve / reject pair on every shift; a single shift keeps the two large buttons.
	 *
	 * The approve / reject decision is taken by the parent tab through
	 * `useReviewApplication`; this row only reports which button was pressed, and for
	 * which applications. Once an application is approved, its shift row also carries the
	 * attendance action (`applicantAttendance`) so staff can check the volunteer in or out
	 * without leaving this tab.
	 *
	 * The applicant's national ID is masked (`maskNationalId`) exactly as the
	 * evacuee screens mask theirs — an approval queue is not a reason to show a
	 * full ID, and the number is only here to help the SM match a walk-in.
	 */
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Clock from '@lucide/svelte/icons/clock';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Phone from '@lucide/svelte/icons/phone';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Check from '@lucide/svelte/icons/check';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { maskNationalId } from '$lib/features/people';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { SvelteMap } from 'svelte/reactivity';
	import { applicantAttendance } from '../domain/applicant-attendance';
	import { APPLICATION_STATUS_META, isHeldForInactiveProfile } from '../domain/applicant-queue';
	import ShiftAttendanceAction from './shift-attendance-action.svelte';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import { checkRequiredSkills } from '../domain/required-skills';
	import {
		JOB_APPLICATION_REVIEW_REASON_LABEL,
		outstandingReviewReasons,
		type JobApplication
	} from '../domain/job-application.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import {
		identityVerificationStatus,
		skillVerificationStatus,
		VERIFICATION_STATUS_LABEL
	} from '../domain/verification';

	let {
		applications,
		volunteer = null,
		volunteerCode = null,
		shiftLabelOf,
		skillOptions = [],
		requiredSkills = [],
		assignments,
		today,
		onreview
	}: {
		/** One applicant's applications for this job, in shift order; never empty. */
		applications: JobApplication[];
		/** Linked roster profile; absent for legacy/unlinked applications. */
		volunteer?: Volunteer | null;
		/** `volunteer.volunteer_code` when the application is linked to a roster record. */
		volunteerCode?: string | null;
		/**
		 * "กะย่อย #n" resolved by the parent against `job.shifts`, or `null` when
		 * nothing on the job matches the application's `selected_shift` anymore
		 * — the SM deleted that sub-shift after this application was filed
		 * (`applicant-queue.ts`'s parent tab never removes the application
		 * itself, only the job's shift row).
		 */
		shiftLabelOf: (application: JobApplication) => string | null;
		/** Effective volunteer skill master data for the current shelter. */
		skillOptions?: readonly SkillOption[];
		/** `job.skills_required` — to warn when a certificate skill the job asks for is missing. */
		requiredSkills?: readonly string[];
		/** Every shift assignment of the shelter; each approved shift row finds its own. */
		assignments: readonly ShiftAssignment[];
		/** `YYYY-MM-DD` in Asia/Bangkok — only a shift dated today can be checked in. */
		today: string;
		onreview: (applications: JobApplication[], decision: 'confirmed' | 'rejected') => void;
	} = $props();

	/** The newest application carries the applicant's latest details (skills only grow). */
	const latest = $derived(
		applications.reduce((newest, item) => (item.created_at > newest.created_at ? item : newest))
	);
	const a = $derived(latest.applicant);
	const fullName = $derived(`${a.first_name} ${a.last_name}`.trim());
	const statusMeta = $derived(APPLICATION_STATUS_META[latest.status]);
	const isPending = $derived(latest.status === 'pending_review');
	const pending = $derived(applications.filter((item) => item.status === 'pending_review'));
	const several = $derived(applications.length > 1);
	/** Filed at — the earliest of the card's applications, the one that set its queue place. */
	const filedAt = $derived(
		applications.reduce(
			(first, item) => (item.created_at < first ? item.created_at : first),
			latest.created_at
		)
	);
	const reviewReasons = $derived([
		...new Set(applications.flatMap((item) => item.review_reasons ?? []))
	]);
	const heldForInactiveProfile = $derived(
		pending.some((item) => isHeldForInactiveProfile(item, volunteer))
	);
	const identityStatus = $derived(volunteer ? identityVerificationStatus(volunteer) : null);
	const skills = $derived.by<{ key: string; label: string; controlled: boolean }[]>(() => {
		const map = new SvelteMap<string, { key: string; label: string; controlled: boolean }>();
		for (const key of a.skills) {
			const entry = resolveSkillOption(key, skillOptions);
			if (entry && !map.has(entry.code)) {
				map.set(entry.code, { key: entry.code, label: entry.label, controlled: entry.controlled });
			}
		}
		return Array.from(map.values());
	});
	/** Certificate skills the job asks for that this applicant did not claim (warning only). */
	const missingCertifiedSkills = $derived(
		checkRequiredSkills(requiredSkills, a.skills, skillOptions, volunteer).filter(
			(check) => check.controlled && check.state === 'missing'
		)
	);
	const openReasons = $derived(
		outstandingReviewReasons(reviewReasons, {
			identityVerified: identityStatus === 'verified',
			uncertifiedSkill: skills.some(
				(s) =>
					s.controlled && (!volunteer || skillVerificationStatus(volunteer, s.key) !== 'verified')
			)
		})
	);

	const identityVerified = $derived(volunteer?.identity_verified ?? false);
</script>

<li class="space-y-2.5 rounded-xl border border-border bg-muted/40 p-3.5">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<span class="text-sm font-bold break-words text-foreground">{fullName}</span>
			<span
				class="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200"
			>
				<UserRound class="h-3 w-3" />
				อาสาสมัคร
			</span>
		</div>
		<span
			class={[
				'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
				statusMeta.chipClass
			]}
		>
			{#if isPending}
				<Hourglass class="h-3 w-3" />
			{/if}
			{statusMeta.queueLabel}
		</span>
	</div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
		{#if volunteerCode}
			<span class="inline-flex items-center gap-1.5">
				<IdCard class="h-3.5 w-3.5" />
				รหัสอาสาสมัคร: <span class="font-mono font-bold text-foreground">{volunteerCode}</span>
			</span>
		{/if}
		<span class="inline-flex items-center gap-1.5">
			<Phone class="h-3.5 w-3.5" />
			{a.phone}
		</span>
		{#if a.national_id}
			<span class="inline-flex items-center gap-1.5">
				<IdCard class="h-3.5 w-3.5" />
				เลขบัตร: <span class="font-mono">{maskNationalId(a.national_id)}</span>
			</span>
		{/if}
		<span
			>ยื่นเมื่อ: <span class="font-bold text-foreground">{formatThaiShortDate(filedAt)}</span
			></span
		>
	</div>

	{#if skills.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted-foreground">ทักษะ:</span>
			{#each skills as skill, idx (`${skill.key}-${idx}`)}
				<span
					class={[
						'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
						skill.controlled
							? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
							: 'bg-background text-foreground ring-1 ring-border'
					]}
					title={skill.controlled
						? 'ทักษะที่ต้องมีใบรับรอง(ต้องตรวจใบรับรองก่อนอนุมัติ)'
						: undefined}
				>
					{#if skill.controlled}
						<ShieldAlert class="h-3 w-3" />
					{/if}
					{skill.label}
				</span>
			{/each}
		</div>
	{/if}

	{#if missingCertifiedSkills.length > 0}
		<p
			class="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200"
		>
			<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<span>
				ไม่มีทักษะที่งานนี้ต้องการ (ต้องมีใบรับรอง):
				{missingCertifiedSkills.map((check) => check.label).join(', ')}
			</span>
		</p>
	{/if}

	<div class="flex flex-wrap items-center gap-1.5 text-xs">
		<span class="font-semibold text-muted-foreground">ผลการตรวจ:</span>
		{#if volunteer}
			<span
				class="rounded-md px-1.5 py-0.5 font-medium {identityStatus === 'verified'
					? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
					: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'}"
			>
				ยืนยันตัวตน: {identityStatus ? VERIFICATION_STATUS_LABEL[identityStatus] : '—'}
			</span>
		{:else}
			<span class="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground ring-1 ring-border">
				ยืนยันตัวตน: ยังไม่มีข้อมูลอาสาในระบบ
			</span>
		{/if}
		{#if heldForInactiveProfile}
			<span
				class="rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200"
			>
				โปรไฟล์นี้ถูกปิดใช้งาน
			</span>
		{/if}
		{#each openReasons as reason (reason)}
			<span class="rounded-md bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200">
				{JOB_APPLICATION_REVIEW_REASON_LABEL[reason]}
			</span>
		{/each}
	</div>

	<ul class="space-y-1.5" aria-label="กะที่สมัคร">
		{#each applications as application (application._id)}
			{@const shift = application.selected_shift}
			{@const shiftLabel = shiftLabelOf(application)}
			{@const shiftPending = application.status === 'pending_review'}
			{@const attendance = applicantAttendance(application, assignments, identityVerified, today)}
			<li
				class={[
					'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
					shiftLabel === null ? 'border-amber-200 bg-amber-50/60' : 'border-border bg-background'
				]}
			>
				<span
					class={[
						'inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-bold',
						shiftLabel === null
							? 'text-amber-900 line-through decoration-amber-400'
							: 'text-foreground'
					]}
				>
					<span class="inline-flex items-center gap-1.5">
						<CalendarDays class="h-3.5 w-3.5 text-primary" />
						กะวันที่: {shift.date}
					</span>
					<span class="inline-flex items-center gap-1.5">
						<Clock class="h-3.5 w-3.5 text-primary" />
						เวลา: {shift.start_time} - {shift.end_time} น.
					</span>
				</span>
				<span class="inline-flex flex-wrap items-center gap-2">
					{#if shiftLabel}
						<span class="text-2xs text-muted-foreground">{shiftLabel}</span>
					{:else}
						<span class="inline-flex items-center gap-1 text-2xs font-bold text-amber-700">
							<TriangleAlert class="h-3 w-3" />
							กะนี้ถูกลบออกจากงานแล้ว
						</span>
					{/if}
					<ShiftAttendanceAction
						{attendance}
						{volunteer}
						personName={fullName}
						shiftLabel="{shift.date} · {shift.start_time} - {shift.end_time} น."
					/>
					{#if several && shiftPending}
						<Button
							size="sm"
							variant="outline"
							class="h-9 gap-1 border-emerald-200 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
							aria-label="อนุมัติกะ {shift.date} {shift.start_time}-{shift.end_time}"
							onclick={() => onreview([application], 'confirmed')}
						>
							<Check class="h-3.5 w-3.5" />
							อนุมัติ
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="h-9 gap-1 border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
							aria-label="ปฏิเสธกะ {shift.date} {shift.start_time}-{shift.end_time}"
							onclick={() => onreview([application], 'rejected')}
						>
							<X class="h-3.5 w-3.5" />
							ปฏิเสธ
						</Button>
					{/if}
				</span>
			</li>
		{/each}
	</ul>

	{#if !isPending && !several && (latest.reviewed_by || latest.reviewed_at || latest.review_notes)}
		<p class="text-2xs text-muted-foreground">
			{#if latest.reviewed_by || latest.reviewed_at}
				พิจารณาโดย {latest.reviewed_by ?? '—'}{latest.reviewed_at
					? ` · ${formatThaiShortDate(latest.reviewed_at)}`
					: ''}
			{/if}
			{#if latest.review_notes}
				<span class="block text-foreground">หมายเหตุ: {latest.review_notes}</span>
			{/if}
		</p>
	{/if}

	{#if several && pending.length > 0}
		<Button
			class="h-10 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
			onclick={() => onreview(pending, 'confirmed')}
		>
			<CheckCheck class="h-4 w-4" />
			อนุมัติทุกกะ ({pending.length} กะ)
		</Button>
	{:else if isPending}
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<Button
				class="h-10 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				onclick={() => onreview([latest], 'confirmed')}
			>
				<Check class="h-4 w-4" />
				อนุมัติเข้าร่วมปฏิบัติงาน
			</Button>
			<Button
				variant="outline"
				class="h-10 w-full gap-1.5 border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
				onclick={() => onreview([latest], 'rejected')}
			>
				<X class="h-4 w-4" />
				ปฏิเสธการสมัคร
			</Button>
		</div>
	{/if}
</li>
