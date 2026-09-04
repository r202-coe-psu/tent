<script lang="ts">
	/**
	 * Job board card (CR-094 FR-VOL-09.2): status badge + ด่วนพิเศษ badge, title/
	 * description, skill tags, 3-color quota bar, shift count, applicant count,
	 * edit button, and a "ดูรายละเอียด" link to the job detail screen
	 * (`/back-office/volunteers/jobs/[id]`, 01-tab-job-board.md §01.5).
	 */
	import { resolve } from '$app/paths';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Flame from '@lucide/svelte/icons/flame';
	import Users from '@lucide/svelte/icons/users';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import JobQuotaBar from './job-quota-bar.svelte';
	import { resolveSkillLabel } from '../domain/skill-catalog';
	import { useSkillOptions } from '../application/queries';
	import type { Job, JobStatus } from '../domain/job.schema';

	let {
		job,
		applicantCount,
		onedit
	}: {
		job: Job;
		applicantCount: number;
		onedit: (job: Job) => void;
	} = $props();

	const STATUS_DISPLAY: Record<JobStatus, { label: string; variant: BadgeVariant }> = {
		draft: { label: 'ร่าง', variant: 'secondary' },
		open: { label: 'เปิดรับ', variant: 'default' },
		paused: { label: 'พักรับ', variant: 'outline' },
		full: { label: 'เต็มโควตา', variant: 'secondary' },
		closed: { label: 'ปิดงาน', variant: 'outline' },
		cancelled: { label: 'ยกเลิก', variant: 'destructive' }
	};

	/**
	 * `skills_required` stores master-data codes (CR-100) — resolve each to its
	 * label here rather than printing the raw value. A code Master Data no
	 * longer carries falls back to itself, so nothing silently disappears.
	 */
	const skillCatalog = useSkillOptions();
	const skillLabels = $derived(
		(job.skills_required ?? []).map((value) => ({
			value,
			label: resolveSkillLabel(value, skillCatalog.options)
		}))
	);

	const statusDisplay = $derived(STATUS_DISPLAY[job.status]);
	/**
	 * `resolve()` in this SvelteKit version only prefixes `base`, so the `[id]`
	 * segment is built here. `job._id` contains a colon (`job:01J…`) — encode it
	 * so the path stays a single valid segment; SvelteKit decodes `params.id`.
	 */
	const detailHref = $derived(
		resolve(`/back-office/volunteers/jobs/${encodeURIComponent(job._id)}`)
	);
	/**
	 * schema_v 3 — capacity lives in `shifts[]`. Show the span the sub-shifts
	 * cover; a single-day job just shows that one date.
	 */
	const shiftDates = $derived([...new Set(job.shifts.map((s) => s.date))].sort());
	const shiftRangeLabel = $derived(
		shiftDates.length === 0
			? 'ยังไม่กำหนดกะ'
			: shiftDates.length === 1
				? shiftDates[0]
				: `${shiftDates[0]} – ${shiftDates[shiftDates.length - 1]}`
	);
</script>

<div class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
	<div class="flex items-start justify-between gap-2">
		<div class="flex flex-wrap items-center gap-1.5">
			<Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
			{#if job.is_urgent}
				<Badge variant="destructive" class="gap-1">
					<Flame class="h-3 w-3" />
					ด่วนพิเศษ
				</Badge>
			{/if}
		</div>
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button {...props} size="icon" variant="ghost" onclick={() => onedit(job)}>
							<Pencil class="h-4 w-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>แก้ไขงาน</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>

	<div class="min-w-0">
		<h3 class="text-sm font-bold break-words text-foreground">{job.title}</h3>
		<p class="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">{job.description}</p>
	</div>

	{#if skillLabels.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each skillLabels as skill (skill.value)}
				<Badge variant="outline" class="max-w-full text-[11px] break-words">{skill.label}</Badge>
			{/each}
		</div>
	{/if}

	<JobQuotaBar {job} />

	<div
		class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs"
	>
		<div class="flex items-center gap-3 text-muted-foreground">
			<span class="inline-flex items-center gap-1">
				<CalendarClock class="h-3.5 w-3.5" />
				{job.shifts.length} กะ · {shiftRangeLabel}
			</span>
			<span class="inline-flex items-center gap-1">
				<Users class="h-3.5 w-3.5" />
				ผู้สมัคร {applicantCount}
			</span>
		</div>
		<Button size="sm" variant="outline" href={detailHref}>ดูรายละเอียด</Button>
	</div>
</div>
