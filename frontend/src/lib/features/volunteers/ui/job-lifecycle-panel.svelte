<script lang="ts">
	/**
	 * LIFECYCLE panel of the job detail Overview tab (approved mockup
	 * 2026-08-27).
	 *
	 * Same option set AND same selected colours as the "สถานะการรับสมัคร
	 * (LIFECYCLE STATUS)" control in `job-form-dialog.svelte` — one status must
	 * not look different depending on which screen you change it from. Both
	 * lists are the editable subset of `jobStatus`; only `cancelled` is left
	 * out, because it is terminal.
	 *
	 * `selectedClass` is written out in full per option — Tailwind scans source
	 * text, so a class name assembled at runtime would never be generated.
	 */
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Check from '@lucide/svelte/icons/check';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Job, JobStatus } from '../domain/job.schema';

	let {
		job,
		pending = false,
		onselect
	}: {
		job: Job;
		pending?: boolean;
		onselect: (status: JobStatus) => void;
	} = $props();

	type LifecycleOption = {
		value: Extract<JobStatus, 'draft' | 'open' | 'paused' | 'full' | 'closed'>;
		label: string;
		hint: string;
		selectedClass: string;
	};

	const OPTIONS: readonly LifecycleOption[] = [
		{
			value: 'draft',
			label: 'ร่าง',
			hint: 'ยังไม่เผยแพร่ — เห็นได้เฉพาะเจ้าหน้าที่ศูนย์',
			selectedClass: 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
		},
		{
			value: 'open',
			label: 'เปิดรับ',
			hint: 'เผยแพร่แล้ว รับสมัครได้ปกติ',
			selectedClass: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
		},
		{
			value: 'paused',
			label: 'พักรับ',
			hint: 'พักรับสมัครชั่วคราว งานยังอยู่บนกระดาน',
			selectedClass: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
		},
		{
			value: 'full',
			label: 'เต็มโควตา',
			hint: 'ปิดรับเพราะครบจำนวน — เลือกเองได้ และระบบจะตั้งให้เองเมื่อโควตาถูกจองครบ',
			selectedClass: 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'
		},
		{
			value: 'closed',
			label: 'ปิดงาน',
			hint: 'จบภารกิจ ไม่รับสมัครเพิ่ม',
			selectedClass: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
		}
	];

	/** Statuses this control cannot select — shown as the current state instead. */
	const DERIVED_STATUS_HINT: Partial<Record<JobStatus, string>> = {
		cancelled: 'งานนี้ถูกยกเลิกแล้ว'
	};

	const activeOption = $derived(OPTIONS.find((o) => o.value === job.status) ?? null);
	const footerHint = $derived(activeOption?.hint ?? DERIVED_STATUS_HINT[job.status] ?? '');
</script>

<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
	<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
		<RefreshCw class="h-4 w-4 shrink-0 text-primary" />
		สถานะวงจรชีวิตงานอาสา (LIFECYCLE)
	</h3>

	<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
		{#each OPTIONS as option (option.value)}
			{@const selected = job.status === option.value}
			<Button
				type="button"
				variant="outline"
				aria-pressed={selected}
				disabled={pending}
				class="!h-11 justify-between {selected ? option.selectedClass : ''}"
				onclick={() => onselect(option.value)}
			>
				<span class="truncate">{option.label}</span>
				{#if selected}
					<Check class="size-4 shrink-0" />
				{/if}
			</Button>
		{/each}
	</div>

	{#if footerHint}
		<p class="mt-3 flex items-start gap-1.5 text-xs break-words text-muted-foreground">
			<Lightbulb class="mt-0.5 size-3.5 shrink-0 text-amber-500" />
			<span>{footerHint}</span>
		</p>
	{/if}

	<p class="mt-2 text-[11px] leading-relaxed break-words text-muted-foreground">
		ค่าที่เลือกที่นี่จะถูกบันทึกตามที่เลือก — ระบบจะปรับเป็น "เต็มโควตา"
		ให้เองก็ต่อเมื่อโควตาถูกจองครบจริง ในการมอบหมาย/ตอบรับครั้งถัดไป
	</p>
</div>
