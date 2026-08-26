<script lang="ts">
	/**
	 * Job board card (CR-094 FR-VOL-09.2): status badge + ด่วนพิเศษ badge, title/
	 * description, skill tags, 3-color quota bar, shift count, applicant count,
	 * edit button, and a "ดูรายละเอียด" affordance kept disabled — the job
	 * detail/dispatch route is 01.5, a later step; this must not link to a
	 * route that doesn't exist yet.
	 */
	import Pencil from '@lucide/svelte/icons/pencil';
	import Flame from '@lucide/svelte/icons/flame';
	import Users from '@lucide/svelte/icons/users';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import JobQuotaBar from './job-quota-bar.svelte';
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
		almost_full: { label: 'ใกล้เต็ม', variant: 'secondary' },
		full: { label: 'เต็มโควตา', variant: 'secondary' },
		closed: { label: 'ปิดงาน', variant: 'outline' },
		cancelled: { label: 'ยกเลิก', variant: 'destructive' }
	};

	const statusDisplay = $derived(STATUS_DISPLAY[job.status]);
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

	<div>
		<h3 class="text-sm font-bold text-foreground">{job.title}</h3>
		<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
	</div>

	{#if job.skills_required && job.skills_required.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each job.skills_required as skill (skill)}
				<Badge variant="outline" class="text-[11px]">{skill}</Badge>
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
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props}>
							<Button size="sm" variant="outline" disabled>ดูรายละเอียด</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>หน้ารายละเอียดงาน/มอบหมายกะ — เปิดใช้งานในขั้นตอนถัดไป</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>
</div>
