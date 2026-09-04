<script lang="ts">
	/**
	 * One applicant block of the job detail "ผู้สมัคร (Applicants & Queue)" tab
	 * (approved mockup 2026-08-30).
	 *
	 * Purely presentational — the decision itself is taken by the parent tab
	 * through `useReviewApplication`; this row only reports which button was
	 * pressed.
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
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { maskNationalId } from '$lib/features/people';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { APPLICATION_STATUS_META } from '../domain/applicant-queue';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import type { JobApplication } from '../domain/job-application.schema';

	let {
		application,
		volunteerCode = null,
		shiftLabel = null,
		skillOptions = [],
		onreview
	}: {
		application: JobApplication;
		/** `volunteer.volunteer_code` when the application is linked to a roster record. */
		volunteerCode?: string | null;
		/**
		 * "กะย่อย #n" resolved by the parent against `job.shifts`, or `null` when
		 * nothing on the job matches the application's `selected_shift` anymore
		 * — the SM deleted that sub-shift after this application was filed
		 * (`applicant-queue.ts`'s parent tab never removes the application
		 * itself, only the job's shift row).
		 */
		shiftLabel?: string | null;
		/** Effective volunteer skill master data for the current shelter. */
		skillOptions?: readonly SkillOption[];
		onreview: (application: JobApplication, decision: 'confirmed' | 'rejected') => void;
	} = $props();

	const a = $derived(application.applicant);
	const fullName = $derived(`${a.first_name} ${a.last_name}`.trim());
	const shift = $derived(application.selected_shift);
	const statusMeta = $derived(APPLICATION_STATUS_META[application.status]);
	const isPending = $derived(application.status === 'pending_review');
	const skills = $derived(
		a.skills.flatMap((key) => {
			const entry = resolveSkillOption(key, skillOptions);
			return entry ? [{ key, label: entry.label, controlled: entry.controlled }] : [];
		})
	);
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
			>ยื่นเมื่อ: <span class="font-bold text-foreground"
				>{formatThaiShortDate(application.created_at)}</span
			></span
		>
	</div>

	{#if skills.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted-foreground">ทักษะ:</span>
			{#each skills as skill (skill.key)}
				<span
					class={[
						'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
						skill.controlled
							? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
							: 'bg-background text-foreground ring-1 ring-border'
					]}
					title={skill.controlled ? 'ทักษะควบคุม — ต้องตรวจเอกสาร/ใบรับรองก่อนอนุมัติ' : undefined}
				>
					{#if skill.controlled}
						<ShieldAlert class="h-3 w-3" />
					{/if}
					{skill.label}
				</span>
			{/each}
		</div>
	{/if}

	<div
		class={[
			'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
			shiftLabel === null ? 'border-amber-200 bg-amber-50/60' : 'border-border bg-background'
		]}
	>
		<span
			class={[
				'inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-bold',
				shiftLabel === null ? 'text-amber-900 line-through decoration-amber-400' : 'text-foreground'
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
		{#if shiftLabel}
			<span class="text-2xs text-muted-foreground">{shiftLabel}</span>
		{:else}
			<span class="inline-flex items-center gap-1 text-2xs font-bold text-amber-700">
				<TriangleAlert class="h-3 w-3" />
				กะนี้ถูกลบออกจากงานแล้ว
			</span>
		{/if}
	</div>

	{#if !isPending && (application.reviewed_by || application.reviewed_at || application.review_notes)}
		<p class="text-2xs text-muted-foreground">
			{#if application.reviewed_by || application.reviewed_at}
				พิจารณาโดย {application.reviewed_by ?? '—'}{application.reviewed_at
					? ` · ${formatThaiShortDate(application.reviewed_at)}`
					: ''}
			{/if}
			{#if application.review_notes}
				<span class="block text-foreground">หมายเหตุ: {application.review_notes}</span>
			{/if}
		</p>
	{/if}

	{#if isPending}
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<Button
				class="h-10 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				onclick={() => onreview(application, 'confirmed')}
			>
				<Check class="h-4 w-4" />
				อนุมัติเข้าร่วมปฏิบัติงาน
			</Button>
			<Button
				variant="outline"
				class="h-10 w-full gap-1.5 border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
				onclick={() => onreview(application, 'rejected')}
			>
				<X class="h-4 w-4" />
				ปฏิเสธการสมัคร
			</Button>
		</div>
	{/if}
</li>
