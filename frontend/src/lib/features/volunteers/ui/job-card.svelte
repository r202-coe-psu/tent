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
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Eye from '@lucide/svelte/icons/eye';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import JobQuotaBar from './job-quota-bar.svelte';
	import { resolveSkillOption } from '../domain/skill-catalog';
	import { useSkillOptions } from '../application/queries';
	import type { Job, JobStatus } from '../domain/job.schema';

	let {
		job,
		applicantCount,
		pendingApplicantCount,
		onedit
	}: {
		job: Job;
		applicantCount: number;
		pendingApplicantCount: number;
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
	 * longer carries is omitted so internal IDs never leak into the UI.
	 */
	const skillCatalog = useSkillOptions();
	const skillLabels = $derived(
		(job.skills_required ?? [])
			.map((value) => ({
				value,
				entry: resolveSkillOption(value, skillCatalog.options)
			}))
			.filter((skill) => skill.entry)
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

<div
	class="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
>
	<div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 flex-wrap items-center gap-1.5">
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
							<Button
								{...props}
								size="icon"
								variant="ghost"
								class="shrink-0 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100"
								onclick={() => onedit(job)}
							>
								<Pencil class="h-4 w-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>แก้ไขงาน</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>

		<div class="min-w-0">
			<h3 class="truncate text-base leading-snug font-bold text-foreground" title={job.title}>
				{job.title}
			</h3>
			<p
				class="mt-1 truncate text-xs leading-relaxed text-muted-foreground"
				title={job.description}
			>
				{job.description}
			</p>
		</div>

		{#if skillLabels.length > 0}
			<div class="flex min-w-0 items-center gap-2">
				<span class="shrink-0 text-[11px] font-semibold text-muted-foreground">ทักษะ</span>
				<div class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
					{#each skillLabels.slice(0, 2) as skill (skill.value)}
						<Badge
							variant="outline"
							class="max-w-[45%] truncate text-[11px]"
							title={skill.entry?.label}>{skill.entry?.label}</Badge
						>
					{/each}
					{#if skillLabels.length > 2}
						<span class="shrink-0 text-[11px] font-semibold text-muted-foreground">
							+{skillLabels.length - 2}
						</span>
					{/if}
				</div>
			</div>
		{/if}

		<div class="rounded-xl bg-muted/35 p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<span class="text-[11px] font-semibold text-muted-foreground">ความคืบหน้าโควตา</span>
				<span class="text-xs font-bold text-foreground">{job.slots_confirmed}/{job.quota}</span>
			</div>
			<JobQuotaBar {job} />
		</div>

		<div class="mt-auto border-t border-border pt-4">
			<div class="space-y-2 text-xs text-muted-foreground">
				<div class="flex min-w-0 items-center gap-2">
					<CalendarClock class="h-3.5 w-3.5 shrink-0 text-primary" />
					<span class="truncate" title={shiftRangeLabel}
						>{job.shifts.length} กะ <span class="text-border">·</span> {shiftRangeLabel}</span
					>
				</div>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
					<span class="inline-flex items-center gap-1">
						<Users class="h-3.5 w-3.5 text-primary" />
						ผู้สมัคร {applicantCount}
					</span>
					<span class="inline-flex items-center gap-1 font-medium text-amber-700">
						<Hourglass class="h-3.5 w-3.5" />
						รอยืนยัน {pendingApplicantCount}
					</span>
				</div>
			</div>

			<Button size="sm" variant="default" class="mt-4 w-full gap-1.5" href={detailHref}>
				<Eye class="h-3.5 w-3.5" /> ดูรายละเอียด
			</Button>
		</div>
	</div>
</div>
