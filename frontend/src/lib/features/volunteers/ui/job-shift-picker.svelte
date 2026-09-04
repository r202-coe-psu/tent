<script module lang="ts">
	import type { Job, JobShift } from '../domain/job.schema';
	import type { DutyWindow } from '../domain/shift-assignment.schema';

	export interface JobShiftSelection {
		job: Job;
		shift: JobShift;
		dutyWindow: DutyWindow;
	}
</script>

<script lang="ts">
	/**
	 * "เลือกงานเพื่อมอบหมายกะ" — the two-step job → shift picker extracted from
	 * `walk-in-registration-dialog.svelte`'s section 3. Pick a job (expands its
	 * shift list), then pick one of that job's open shifts, today or upcoming.
	 *
	 * `operational` tier only: a `staff-capable` job's role grant needs a
	 * `_users` account (FR-VOL-05R), which a walk-in `personnel_type:
	 * 'volunteer'` profile never has.
	 *
	 * Recommends ("แนะนำ") jobs whose `skills_required` overlaps
	 * `selectedSkills` (`hasAnyRequiredSkill`) — silent until the caller has
	 * ticked at least one skill.
	 *
	 * Reports the chosen `{ job, shift, dutyWindow }` (or `null`) via `onchange`
	 * — the host owns what happens with it (job-assign + optional check-in).
	 * Resets its own expand/pick state whenever `open` goes false, since a host
	 * dialog typically stays mounted across opens rather than remounting.
	 */
	import { SvelteMap } from 'svelte/reactivity';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { useJobs, todayDateString, useSkillOptions } from '../application/queries';
	import { jobShiftQuotaSplits } from '../domain/capacity';
	import { shiftDutyWindow } from '../domain/duty-window';
	import { hasAnyRequiredSkill, resolveSkillOption } from '../domain/skill-catalog';

	let {
		open,
		selectedSkills,
		onchange
	}: {
		/** Reset trigger — clears the picker's own expand/pick state when this goes false. */
		open: boolean;
		selectedSkills: string[];
		onchange?: (selection: JobShiftSelection | null) => void;
	} = $props();

	const skillCatalog = useSkillOptions();
	const skillsList = $derived(skillCatalog.options);

	/** Bangkok "today" — the lower bound for which shifts are offered. */
	const today = todayDateString();

	/** "วันนี้" for today, since the picker spans upcoming days too. */
	function formatShiftDate(date: string): string {
		if (date === today) return 'วันนี้';
		return new Date(date).toLocaleDateString('th-TH', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Bangkok'
		});
	}

	/**
	 * Every open `operational` job shift with an open seat, today or upcoming
	 * (past dates dropped). `key` reuses `jobShiftQuotaSplits`'s
	 * `${job_id}#${shift.id}` so it lines up with the same per-shift split every
	 * other roster/detail screen reads.
	 */
	interface AssignableShift {
		key: string;
		job: Job;
		shift: JobShift;
		remaining: number;
		/** `job.skills_required` resolved to display labels (CR-100 — stored as master codes). */
		requiredSkillLabels: string[];
		skillMatch: boolean;
		/** Precomputed so the reported selection and any duty-window check downstream never recompute it differently. */
		dutyWindow: DutyWindow;
	}

	const jobsQuery = useJobs();

	const assignableShifts = $derived.by<AssignableShift[]>(() => {
		const jobs = (jobsQuery.data ?? []).filter(
			(j) => j.tier === 'operational' && j.status === 'open'
		);
		const out: AssignableShift[] = [];
		for (const job of jobs) {
			const splits = jobShiftQuotaSplits(job);
			const required = job.skills_required ?? [];
			const requiredSkillLabels = required.flatMap((value) => {
				const option = resolveSkillOption(value, skillsList);
				return option ? [option.label] : [];
			});
			job.shifts.forEach((shift, index) => {
				const split = splits[index];
				if (!split || shift.date < today || split.remaining <= 0) return;
				try {
					out.push({
						key: split.key,
						job,
						shift,
						remaining: split.remaining,
						requiredSkillLabels,
						skillMatch:
							selectedSkills.length > 0 &&
							hasAnyRequiredSkill(selectedSkills, required, skillsList),
						dutyWindow: shiftDutyWindow(shift)
					});
				} catch {
					// A malformed shift's window can't be computed — drop it rather
					// than crash the picker over one bad row (same guard
					// `assign-roster.ts` uses around this same call).
				}
			});
		}
		// Recommended (skill match) shifts float to the top; earliest shift first
		// within a tie, so each job group's shifts land in chronological order
		// regardless of how `job.shifts[]` itself was stored.
		return out.toSorted((a, b) => {
			const bySkill = Number(b.skillMatch) - Number(a.skillMatch);
			if (bySkill !== 0) return bySkill;
			return `${a.shift.date}${a.shift.start_time}`.localeCompare(
				`${b.shift.date}${b.shift.start_time}`
			);
		});
	});

	/** One job header with the shift picker (`AssignableShift[]`) shown once it's expanded. */
	interface JobGroup {
		job: Job;
		requiredSkillLabels: string[];
		skillMatch: boolean;
		shifts: AssignableShift[];
	}

	/** Groups `assignableShifts` by job for the two-step "pick a job, then pick its shift" picker — `assignableShifts` is already skill-match-sorted, so first-seen order here follows the same order. */
	const jobGroups = $derived.by<JobGroup[]>(() => {
		const groups = new SvelteMap<string, JobGroup>();
		for (const item of assignableShifts) {
			let group = groups.get(item.job._id);
			if (!group) {
				group = {
					job: item.job,
					requiredSkillLabels: item.requiredSkillLabels,
					skillMatch: item.skillMatch,
					shifts: []
				};
				groups.set(item.job._id, group);
			}
			group.shifts.push(item);
		}
		return Array.from(groups.values());
	});

	let selectedJobId = $state<string | null>(null);
	let selectedShiftKey = $state<string | null>(null);

	$effect(() => {
		if (!open) {
			selectedJobId = null;
			selectedShiftKey = null;
		}
	});

	/** Expands/collapses one job's shift picker — independent of which shift (if any) is chosen. */
	function selectJob(jobId: string) {
		selectedJobId = selectedJobId === jobId ? null : jobId;
	}

	function selectShift(key: string) {
		selectedShiftKey = selectedShiftKey === key ? null : key;
		const found = assignableShifts.find((a) => a.key === selectedShiftKey) ?? null;
		onchange?.(found ? { job: found.job, shift: found.shift, dutyWindow: found.dutyWindow } : null);
	}
</script>

<div class="space-y-2">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-xs font-bold text-foreground">
			3. เลือกงานเพื่อมอบหมายกะ (ASSIGN TO JOB) — ไม่บังคับ
		</p>
		{#if selectedSkills.length > 0}
			<span class="flex items-center gap-1 text-[11px] text-muted-foreground">
				<Sparkles class="h-3 w-3 text-emerald-600" />
				แนะนำงานที่ตรงกับทักษะที่เลือกไว้ก่อน
			</span>
		{/if}
	</div>

	{#if jobsQuery.isPending}
		<p
			class="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground"
		>
			กำลังโหลดงานที่เปิดรับ...
		</p>
	{:else if assignableShifts.length === 0}
		<p
			class="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground"
		>
			ไม่มีกะงานที่เปิดรับ — ลงทะเบียนแบบไม่ผูกงานได้ตามปกติ
		</p>
	{:else}
		<div class="space-y-2">
			{#each jobGroups as group (group.job._id)}
				{@const jobActive = selectedJobId === group.job._id}
				<div
					class="overflow-hidden rounded-xl border {jobActive
						? 'border-primary-dark'
						: 'border-border'}"
				>
					<button
						type="button"
						onclick={() => selectJob(group.job._id)}
						aria-expanded={jobActive}
						class="flex w-full items-center justify-between gap-2 p-3 text-left text-xs transition-colors {jobActive
							? 'bg-primary-dark text-white'
							: 'text-foreground hover:bg-muted/40'}"
					>
						<span class="min-w-0 flex-1">
							<span class="flex flex-wrap items-center gap-1.5">
								<span class="truncate font-bold">{group.job.title}</span>
								{#if group.skillMatch}
									<Badge class="shrink-0 gap-1 border-none bg-emerald-500 text-[10px] text-white">
										<Sparkles class="h-2.5 w-2.5" />
										แนะนำ
									</Badge>
								{/if}
							</span>
							{#if group.requiredSkillLabels.length > 0}
								<span class="mt-1 flex flex-wrap gap-1">
									{#each group.requiredSkillLabels as label (label)}
										<Badge
											variant="outline"
											class="text-[10px] {jobActive
												? 'border-white/40 text-white'
												: 'text-muted-foreground'}"
										>
											{label}
										</Badge>
									{/each}
								</span>
							{/if}
						</span>
						<ChevronDown
							class="h-4 w-4 shrink-0 transition-transform {jobActive ? 'rotate-180' : ''}"
						/>
					</button>

					{#if jobActive}
						<div class="grid grid-cols-1 gap-2 border-t border-border p-3 sm:grid-cols-2">
							{#each group.shifts as item (item.key)}
								{@const shiftActive = selectedShiftKey === item.key}
								<button
									type="button"
									onclick={() => selectShift(item.key)}
									aria-pressed={shiftActive}
									class="rounded-lg border p-2.5 text-left text-xs transition-colors {shiftActive
										? 'border-primary bg-primary/10 font-bold text-primary'
										: 'border-border text-foreground hover:bg-muted/40'}"
								>
									{formatShiftDate(item.shift.date)}
									{#if item.shift.end_date !== item.shift.date}
										→ {formatShiftDate(item.shift.end_date)}
									{/if}
									· {item.shift.start_time} - {item.shift.end_time} · ว่างอีก {item.remaining} ที่
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
