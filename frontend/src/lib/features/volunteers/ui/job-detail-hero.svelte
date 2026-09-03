<script lang="ts">
	/**
	 * Job detail hero (01-tab-job-board.md §01.5 "สรุปงาน + Quota Bar").
	 *
	 * Dark `primary-dark` slab in the same visual language as
	 * `volunteer-hub-header.svelte`, per the approved mockup 2026-08-27:
	 * status/urgent badges, title + description, then the job-level personnel
	 * summary.
	 *
	 * The former 3-colour "Multi-State Quota" block is gone (owner decision
	 * 2026-09-02): the bar counts APPROVED volunteers only — 🟢 ยืนยันแล้ว
	 * (`slots_confirmed`) against ⚪ ยังขาดอีก — matching the job board card and
	 * the sub-shift cards, so an offer nobody has accepted yet is not read as
	 * staffing anywhere in the UI.
	 *
	 * The split is still read from `domain/quota.ts#computeQuota`, so the job's
	 * quota invariant is validated here and no counter is derived locally.
	 */
	import Flame from '@lucide/svelte/icons/flame';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Users from '@lucide/svelte/icons/users';
	import { computeQuota } from '../domain/quota';
	import type { Job, JobStatus } from '../domain/job.schema';

	let {
		job,
		applicantCount
	}: {
		job: Job;
		applicantCount: number;
	} = $props();

	/**
	 * On the dark slab the shadcn `Badge` variants (built for a light card) lose
	 * their contrast, so each status carries its own explicit pair. Written out
	 * in full because Tailwind scans source text.
	 */
	const STATUS_DISPLAY: Record<JobStatus, { label: string; class: string }> = {
		draft: { label: 'ร่าง', class: 'bg-white/10 text-white/80 ring-white/15' },
		open: {
			label: 'เปิดรับสมัคร',
			class: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30'
		},
		paused: { label: 'พักรับสมัคร', class: 'bg-amber-400/15 text-amber-300 ring-amber-400/30' },
		almost_full: { label: 'ใกล้เต็ม', class: 'bg-amber-400/15 text-amber-200 ring-amber-400/30' },
		full: { label: 'เต็มโควตา', class: 'bg-violet-400/15 text-violet-300 ring-violet-400/30' },
		closed: { label: 'ปิดงาน', class: 'bg-white/10 text-white/70 ring-white/15' },
		cancelled: { label: 'ยกเลิก', class: 'bg-rose-400/15 text-rose-300 ring-rose-400/30' }
	};

	const statusDisplay = $derived(STATUS_DISPLAY[job.status]);
	const quota = $derived(computeQuota(job));
	/** Everything not yet approved — dispatched-but-unanswered seats included. */
	const missing = $derived(quota.dispatched + quota.remaining);
	/** Guard the divide-by-zero: a stored job always has `quota > 0`, but a bar must never render NaN%. */
	const total = $derived(job.quota > 0 ? job.quota : 1);
</script>

<section
	class="relative overflow-hidden rounded-3xl bg-primary-dark px-5 py-5 text-white sm:px-8 sm:py-7"
>
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(255,255,255,0.08),transparent_55%)]"
	></div>

	<div class="relative">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex flex-wrap items-center gap-2">
				{#if job.is_urgent}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-rose-400/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 ring-1 ring-rose-400/30"
					>
						<Flame class="h-3 w-3" />
						ด่วนพิเศษ
					</span>
				{/if}
				<span
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 {statusDisplay.class}"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
					{statusDisplay.label}
				</span>
			</div>

			<div
				class="inline-flex items-center gap-3 rounded-full bg-white/8 px-3.5 py-1.5 text-xs font-medium ring-1 ring-white/10"
			>
				<span class="inline-flex items-center gap-1.5">
					<ChartColumn class="h-3.5 w-3.5 text-sky-300" />
					{job.shifts.length} กะปฏิบัติงาน
				</span>
				<span aria-hidden="true" class="h-1 w-1 rounded-full bg-white/30"></span>
				<span class="inline-flex items-center gap-1.5">
					<Users class="h-3.5 w-3.5 text-sky-300" />
					ผู้สมัคร {applicantCount} คน
				</span>
			</div>
		</div>

		<h1 class="mt-4 text-2xl font-bold tracking-tight break-words sm:text-3xl">{job.title}</h1>
		<p class="mt-1.5 max-w-3xl text-sm leading-relaxed break-words text-white/60">
			{job.description}
		</p>

		<div class="mt-5 border-t border-white/10 pt-4">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="text-xs font-bold text-amber-300 sm:text-sm">สรุปกำลังพลรวมทุกกะ</h2>
				<p class="text-sm font-bold tabular-nums">
					{quota.confirmed} / {job.quota} <span class="font-medium text-white/60">คน</span>
				</p>
			</div>

			<div class="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-white/12">
				<div class="h-full bg-emerald-400" style:width="{(quota.confirmed / total) * 100}%"></div>
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/10"
				>
					<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
					ยืนยันแล้ว: <span class="font-bold tabular-nums">{quota.confirmed}</span>
				</span>
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/10"
				>
					<span class="h-2 w-2 rounded-full bg-white/40"></span>
					ยังขาดอีก: <span class="font-bold tabular-nums">{missing}</span>
				</span>
				<span class="ml-auto text-[11px] text-white/45">(เป้า {job.quota} คน)</span>
			</div>
		</div>
	</div>
</section>
