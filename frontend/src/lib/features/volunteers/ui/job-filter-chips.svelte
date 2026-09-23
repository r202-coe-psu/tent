<script module lang="ts">
	import type { JobStatus } from '../domain/job.schema';

	export type JobBoardStatusFilter = JobStatus | 'all';
</script>

<script lang="ts">
	/**
	 * Job board filter chips (CR-094 FR-VOL-09.3).
	 *
	 * "ไม่รวมงานที่ปิดแล้ว" is a default-on toggle that only applies while no
	 * specific status chip is selected (`status === 'all'`) — it hides `closed`
	 * and `cancelled` jobs. Picking a status chip (เปิดรับ/พักรับ/เต็มโควตา/ร่าง/
	 * ปิดงาน) narrows to exactly that status. "ด่วนพิเศษ" is an independent
	 * toggle that combines with whichever status is active. "แสดงทั้งหมด" resets
	 * both the status filter and the exclude-closed toggle. This chip
	 * interaction shape is not specified by CR-094/01-tab-job-board.md beyond
	 * the chip list itself — documented judgment call, flagged for owner review.
	 */
	let {
		status = $bindable<JobBoardStatusFilter>('all'),
		excludeClosed = $bindable(true),
		urgentOnly = $bindable(false)
	}: {
		status?: JobBoardStatusFilter;
		excludeClosed?: boolean;
		urgentOnly?: boolean;
	} = $props();

	const statusChips: { value: JobStatus; label: string }[] = [
		{ value: 'open', label: 'เปิดรับ' },
		{ value: 'paused', label: 'พักรับ' },
		{ value: 'full', label: 'เต็มโควตา' },
		{ value: 'draft', label: 'ร่าง' },
		{ value: 'closed', label: 'ปิดงาน' }
	];

	function selectStatus(value: JobStatus) {
		status = status === value ? 'all' : value;
	}

	function showAll() {
		status = 'all';
		excludeClosed = false;
	}

	const chipBase =
		'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors';
	const chipOn = 'border-primary bg-primary text-primary-foreground';
	const chipOff = 'border-border bg-background text-muted-foreground hover:bg-muted';
</script>

<div class="flex flex-wrap items-center gap-2">
	<button
		type="button"
		class="{chipBase} {status === 'all' && excludeClosed ? chipOn : chipOff}"
		disabled={status !== 'all'}
		onclick={() => (excludeClosed = !excludeClosed)}
	>
		ไม่รวมงานที่ปิดแล้ว
	</button>

	<button
		type="button"
		class="{chipBase} {urgentOnly ? 'border-destructive bg-destructive text-white' : chipOff}"
		onclick={() => (urgentOnly = !urgentOnly)}
	>
		ด่วนพิเศษ
	</button>

	<span class="mx-1 h-4 w-px bg-border"></span>

	{#each statusChips as chip (chip.value)}
		<button
			type="button"
			class="{chipBase} {status === chip.value ? chipOn : chipOff}"
			onclick={() => selectStatus(chip.value)}
		>
			{chip.label}
		</button>
	{/each}

	<button
		type="button"
		class="{chipBase} {status === 'all' && !excludeClosed ? chipOn : chipOff}"
		onclick={showAll}
	>
		แสดงทั้งหมด
	</button>
</div>
