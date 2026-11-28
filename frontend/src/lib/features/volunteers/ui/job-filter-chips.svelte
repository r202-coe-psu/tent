<script module lang="ts">
	import type { JobStatus } from '../domain/job.schema';

	export type JobBoardStatusFilter = JobStatus | 'all';
</script>

<script lang="ts">
	/**
	 * Job board filters (CR-094 FR-VOL-09.3), grouped by what they do:
	 *
	 * - Left, tabs: the status to look at — exactly one at a time (ทั้งหมด, เปิดรับ, พักรับ,
	 *   เต็มโควตา, ร่าง, ปิดงาน).
	 * - Right, switches: "ซ่อนงานที่ปิดแล้ว" hides `closed` and `cancelled` jobs and only applies
	 *   under "ทั้งหมด" — a specific status already says what to show, so the switch is
	 *   disabled then and can never contradict it. "ด่วนพิเศษ" combines with any status.
	 */
	import Flame from '@lucide/svelte/icons/flame';
	import { Switch } from '$lib/components/ui/switch/index.js';

	let {
		status = $bindable<JobBoardStatusFilter>('all'),
		excludeClosed = $bindable(true),
		urgentOnly = $bindable(false)
	}: {
		status?: JobBoardStatusFilter;
		excludeClosed?: boolean;
		urgentOnly?: boolean;
	} = $props();

	const tabs: { value: JobBoardStatusFilter; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'open', label: 'เปิดรับ' },
		{ value: 'paused', label: 'พักรับ' },
		{ value: 'full', label: 'เต็มโควตา' },
		{ value: 'draft', label: 'ร่าง' },
		{ value: 'closed', label: 'ปิดงาน' }
	];

	const switchLocked = $derived(status !== 'all');
</script>

<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
	<div role="tablist" aria-label="สถานะงาน" class="flex flex-wrap items-center gap-x-1 gap-y-1">
		{#each tabs as tab (tab.value)}
			<button
				type="button"
				role="tab"
				aria-selected={status === tab.value}
				class="min-h-9 border-b-2 px-3 text-sm font-medium transition-colors {status === tab.value
					? 'border-primary font-bold text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (status = tab.value)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<label
			class="inline-flex items-center gap-2 text-xs font-medium {switchLocked
				? 'text-muted-foreground/60'
				: 'text-foreground'}"
		>
			<Switch bind:checked={excludeClosed} disabled={switchLocked} aria-label="ซ่อนงานที่ปิดแล้ว" />
			ซ่อนงานที่ปิดแล้ว
		</label>
		<button
			type="button"
			aria-pressed={urgentOnly}
			class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {urgentOnly
				? 'border-destructive bg-destructive text-white'
				: 'border-border bg-background text-muted-foreground hover:bg-muted'}"
			onclick={() => (urgentOnly = !urgentOnly)}
		>
			<Flame class="h-3.5 w-3.5" />
			ด่วนพิเศษ
		</button>
	</div>
</div>
