<script lang="ts">
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ImportJobItem, ImportJobSummary, ImportItemStatus } from '../application/queries';

	let {
		data,
		retrying = false,
		onretry
	}: {
		data: ImportJobSummary | null | undefined;
		retrying?: boolean;
		onretry?: () => void;
	} = $props();

	const failedStatuses: ImportItemStatus[] = ['failed', 'validation_error'];

	function isFailed(item: ImportJobItem): boolean {
		return failedStatuses.includes(item.status);
	}

	function isRetryable(item: ImportJobItem): boolean {
		return item.status === 'failed' && item.attempts < (item.max_attempts ?? 3);
	}

	function statusLabel(status: ImportItemStatus): string {
		return {
			pending: 'รอคิว',
			running: 'กำลังนำเข้า',
			created: 'นำเข้าสำเร็จ',
			updated: 'อัปเดตสำเร็จ',
			skipped: 'ข้าม (ซ้ำ)',
			failed: 'ล้มเหลว',
			validation_error: 'ข้อมูลไม่ผ่านการตรวจสอบ'
		}[status];
	}

	function statusVariant(status: ImportItemStatus): 'secondary' | 'outline' | 'destructive' {
		if (status === 'created' || status === 'updated') return 'secondary';
		if (status === 'failed' || status === 'validation_error') return 'destructive';
		return 'outline';
	}

	function errorText(item: ImportJobItem): string {
		return (item.errors ?? []).map((error) => `${error.column}: ${error.message}`).join('; ');
	}

	const completedCount = $derived(
		data?.job ? data.job.succeeded + data.job.skipped + data.job.failed : 0
	);
	const total = $derived(data?.job.total ?? 0);
	const percentage = $derived(
		total > 0 ? Math.min(100, Math.round((completedCount / total) * 100)) : 0
	);
	const retryableFailedItems = $derived((data?.items ?? []).filter(isRetryable));
	const running = $derived(data?.job.status === 'queued' || data?.job.status === 'running');
</script>

{#if data}
	<section
		class="space-y-4 rounded-xl border border-sky-200 bg-white p-4 shadow-xs sm:p-5"
		aria-busy={running}
		aria-label="ความคืบหน้าการนำเข้าศูนย์พักพิง"
	>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h3 class="text-base font-semibold text-slate-900">
					{running ? 'กำลังประมวลผล' : 'สรุปผลการนำเข้า'}
					{data.job.filename}
				</h3>
				<p class="mt-1 text-sm text-slate-600" aria-live="polite">
					ดำเนินการแล้ว {completedCount.toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} ศูนย์
				</p>
			</div>
			<div class="flex items-center gap-2" aria-live="polite">
				{#if running}
					<LoaderCircle class="h-4 w-4 animate-spin text-sky-700" aria-hidden="true" />
					<Badge variant="outline" class="border-sky-200 bg-sky-50 text-sky-900">กำลังทำงาน</Badge>
				{:else if data.job.failed > 0}
					<AlertCircle class="h-4 w-4 text-amber-700" aria-hidden="true" />
					<Badge variant="outline" class="border-amber-200 bg-amber-50 text-amber-900"
						>เสร็จพร้อมข้อผิดพลาด</Badge
					>
				{:else}
					<CheckCircle2 class="h-4 w-4 text-emerald-700" aria-hidden="true" />
					<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-900"
						>เสร็จสมบูรณ์</Badge
					>
				{/if}
			</div>
		</div>

		<div
			class="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"
		>
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
			<p>
				ระบบทำงานต่อทีละศูนย์ หากศูนย์ใดล้มเหลวจะบันทึกเฉพาะรายการนั้นและประมวลผลรายการถัดไปต่อ
				จึงไม่ยกเลิกทั้งงาน โดยสามารถลองใหม่เฉพาะรายการที่ล้มเหลวได้
			</p>
		</div>

		<div
			class="h-2 w-full overflow-hidden rounded-full bg-slate-100"
			role="progressbar"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={percentage}
			aria-label={`ความคืบหน้า ${percentage}%`}
		>
			<div
				class="h-full rounded-full bg-sky-600 transition-[width] duration-300"
				style={`width: ${percentage}%`}
			></div>
		</div>

		<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
			<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
				<span class="block text-xs font-semibold">สำเร็จ</span><span
					class="text-lg font-bold tabular-nums">{data.job.succeeded}</span
				>
			</div>
			<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
				<span class="block text-xs font-semibold">ข้ามซ้ำ</span><span
					class="text-lg font-bold tabular-nums">{data.job.skipped}</span
				>
			</div>
			<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
				<span class="block text-xs font-semibold">ล้มเหลว</span><span
					class="text-lg font-bold tabular-nums">{data.job.failed}</span
				>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-3 text-slate-700">
				<span class="block text-xs font-semibold">รอคิว</span><span
					class="text-lg font-bold tabular-nums">{data.job.pending}</span
				>
			</div>
		</div>

		{#if retryableFailedItems.length > 0 && onretry}
			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
			>
				<span>มี {retryableFailedItems.length} รายการที่ล้มเหลว สามารถส่งกลับเข้าคิวได้</span>
				<Button variant="outline" size="sm" onclick={onretry} disabled={retrying}>
					<RotateCcw class="mr-2 h-4 w-4" aria-hidden="true" />
					{retrying ? 'กำลังส่งกลับเข้าคิว...' : 'ลองรายการที่ล้มเหลวอีกครั้ง'}
				</Button>
			</div>
		{/if}

		<div class="overflow-x-auto rounded-xl border border-slate-200/80">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-16 text-center">แถว</Table.Head>
						<Table.Head>ชื่อศูนย์พักพิง</Table.Head>
						<Table.Head class="w-44">สถานะ</Table.Head>
						<Table.Head>รหัส / รายละเอียด</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.items as item (item.row)}
						<Table.Row>
							<Table.Cell class="text-center text-slate-600 tabular-nums">{item.row}</Table.Cell>
							<Table.Cell class="min-w-48 font-medium text-slate-800">{item.name ?? '—'}</Table.Cell
							>
							<Table.Cell>
								<Badge variant={statusVariant(item.status)}>
									{#if item.status === 'running'}<LoaderCircle
											class="animate-spin"
											aria-hidden="true"
										/>{:else if item.status === 'created' || item.status === 'updated'}<CheckCircle2
											aria-hidden="true"
										/>{:else if isFailed(item)}<AlertCircle
											aria-hidden="true"
										/>{:else if item.status === 'skipped'}<SkipForward
											aria-hidden="true"
										/>{:else}<Clock3 aria-hidden="true" />{/if}
									{statusLabel(item.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell class="min-w-72 text-sm text-slate-600">
								{#if item.code}<span class="font-semibold text-slate-900">{item.code}</span
									>{:else if errorText(item)}<span class="text-red-700">{errorText(item)}</span
									>{:else}—{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</section>
{/if}
