<script lang="ts">
	import { resolve } from '$app/paths';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Eye from '@lucide/svelte/icons/eye';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		useImportLogs,
		isImportJobTerminal,
		type ImportJobSummary
	} from '../application/queries';
	import type { ImportRowResult, ShelterImportLog } from '../domain/import-log';

	let {
		basePath,
		activeJob = null,
		onprogress
	}: {
		basePath?: string;
		activeJob?: ImportJobSummary | null;
		onprogress?: () => void;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/system-management/shelters'));

	const logsQuery = useImportLogs();
	const logs = $derived(logsQuery.data ?? []);
	const activeJobIsRunning = $derived(
		Boolean(activeJob && !isImportJobTerminal(activeJob.job.status))
	);

	let selectedLog = $state<ShelterImportLog | null>(null);
	let resultsDialogOpen = $state(false);
	let resultFilter = $state<'success' | 'failed'>('success');

	const selectedRows = $derived(
		selectedLog
			? resultFilter === 'success'
				? createdRows(selectedLog.results)
				: failedRows(selectedLog.results)
			: []
	);

	function formatTime(iso: string | undefined): string {
		return iso
			? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
			: '—';
	}

	function createdRows(results: ImportRowResult[] = []): ImportRowResult[] {
		return results.filter((row) => row.status === 'created' || row.status === 'updated');
	}

	function failedRows(results: ImportRowResult[] = []): ImportRowResult[] {
		return results.filter(
			(row) => row.status === 'validation_error' || row.status === 'server_error'
		);
	}

	function skippedCount(log: ShelterImportLog): number {
		return log.skipped_count ?? 0;
	}

	function updatedCount(log: ShelterImportLog): number {
		return log.updated_count ?? 0;
	}

	function createdCount(log: ShelterImportLog): number {
		return Math.max(0, log.success_count - updatedCount(log));
	}

	function logStatus(log: ShelterImportLog): 'completed' | 'completed_with_errors' | 'failed' {
		if (log.error_count > 0 && log.success_count === 0 && skippedCount(log) === 0) return 'failed';
		if (log.error_count > 0) return 'completed_with_errors';
		return 'completed';
	}

	function statusLabel(status: ReturnType<typeof logStatus>): string {
		return {
			completed: 'เสร็จสมบูรณ์',
			completed_with_errors: 'เสร็จพร้อมข้อผิดพลาด',
			failed: 'ล้มเหลว'
		}[status];
	}

	function resultStatusLabel(row: ImportRowResult): string {
		return {
			created: 'นำเข้าใหม่',
			updated: 'อัปเดตข้อมูล',
			skipped_duplicate: 'ข้ามรายการซ้ำ',
			validation_error: 'ข้อมูลไม่ผ่านการตรวจสอบ',
			server_error: 'สร้างไม่สำเร็จ'
		}[row.status];
	}

	function resultErrorText(row: ImportRowResult): string {
		const message = (row.errors ?? [])
			.map((error) => `${error.column}: ${error.message}`)
			.join('; ');
		return message || 'ไม่ทราบสาเหตุ';
	}

	function openResults(log: ShelterImportLog, filter: 'success' | 'failed') {
		selectedLog = log;
		resultFilter = filter;
		resultsDialogOpen = true;
	}
</script>

<div class="overflow-x-auto rounded-xl border border-slate-200/80">
	{#if logsQuery.isLoading}
		<p class="py-10 text-center text-sm text-slate-600">กำลังโหลดประวัติ...</p>
	{:else if logs.length === 0 && !activeJobIsRunning}
		<p class="py-10 text-center text-sm text-slate-600">ยังไม่มีประวัติการนำเข้า</p>
	{:else}
		<Table.Root class="min-w-[760px]">
			<Table.Header>
				<Table.Row class="bg-slate-50/80 hover:bg-slate-50/80">
					<Table.Head>ไฟล์นำเข้า / ผู้ดำเนินการ</Table.Head>
					<Table.Head>สถานะ</Table.Head>
					<Table.Head>สรุปผล</Table.Head>
					<Table.Head class="text-right">จำนวนแถว</Table.Head>
					<Table.Head class="text-right">การดำเนินการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if activeJobIsRunning && activeJob}
					<Table.Row class="bg-sky-50/40">
						<Table.Cell>
							<div class="flex items-start gap-3">
								<div class="mt-0.5 rounded-lg bg-sky-100 p-2 text-sky-800">
									<FileSpreadsheet class="h-4 w-4" aria-hidden="true" />
								</div>
								<div>
									<p class="font-semibold text-slate-900">{activeJob.job.filename}</p>
									<p class="mt-1 text-xs text-slate-600">
										งานปัจจุบัน · โดย {activeJob.job.imported_by}
									</p>
								</div>
							</div>
						</Table.Cell>
						<Table.Cell>
							<Badge variant="outline" class="border-sky-200 bg-sky-50 text-sky-900">
								<LoaderCircle class="animate-spin" aria-hidden="true" />
								กำลังทำงาน
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-sm text-slate-700">
							<span class="font-semibold tabular-nums">{activeJob.job.succeeded}</span> สำเร็จ
							<span class="mx-1 text-slate-400">·</span>
							<span class="font-semibold tabular-nums">{activeJob.job.failed}</span> ล้มเหลว
						</Table.Cell>
						<Table.Cell class="text-right text-slate-700 tabular-nums">
							{activeJob.job.total}
						</Table.Cell>
						<Table.Cell class="text-right">
							<Button variant="outline" size="sm" onclick={() => onprogress?.()}>
								<Eye class="mr-1.5 h-4 w-4" aria-hidden="true" /> ดู progress
							</Button>
						</Table.Cell>
					</Table.Row>
				{/if}

				{#each logs as log (log._id)}
					{@const status = logStatus(log)}
					{@const success = createdRows(log.results)}
					{@const failures = failedRows(log.results)}
					<Table.Row>
						<Table.Cell>
							<div class="flex items-start gap-3">
								<div class="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-700">
									<FileSpreadsheet class="h-4 w-4" aria-hidden="true" />
								</div>
								<div>
									<p class="font-semibold text-slate-900">{log.filename}</p>
									<p class="mt-1 text-xs text-slate-600">
										{formatTime(log.finished_at)} · โดย {log.imported_by}
									</p>
								</div>
							</div>
						</Table.Cell>
						<Table.Cell>
							{#if status === 'completed'}
								<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-900">
									<CheckCircle2 aria-hidden="true" />
									{statusLabel(status)}
								</Badge>
							{:else if status === 'completed_with_errors'}
								<Badge variant="outline" class="border-amber-200 bg-amber-50 text-amber-900">
									<AlertCircle aria-hidden="true" />
									{statusLabel(status)}
								</Badge>
							{:else}
								<Badge variant="destructive">
									<AlertCircle aria-hidden="true" />
									{statusLabel(status)}
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-sm text-slate-700">
							<div class="flex flex-wrap gap-x-3 gap-y-1">
								{#if createdCount(log) > 0}
									<span><strong class="tabular-nums">{createdCount(log)}</strong> สร้างใหม่</span>
								{/if}
								{#if updatedCount(log) > 0}
									<span><strong class="tabular-nums">{updatedCount(log)}</strong> อัปเดต</span>
								{/if}
								{#if skippedCount(log) > 0}
									<span><strong class="tabular-nums">{skippedCount(log)}</strong> ข้าม</span>
								{/if}
								{#if log.error_count > 0}
									<span class="text-red-700"
										><strong class="tabular-nums">{log.error_count}</strong> ล้มเหลว</span
									>
								{/if}
							</div>
						</Table.Cell>
						<Table.Cell class="text-right text-slate-700 tabular-nums">{log.total_rows}</Table.Cell>
						<Table.Cell class="text-right">
							<div class="flex flex-wrap justify-end gap-2">
								{#if success.length > 0}
									<Button variant="outline" size="sm" onclick={() => openResults(log, 'success')}>
										<Eye class="mr-1.5 h-4 w-4" aria-hidden="true" /> ดูศูนย์ที่นำเข้าแล้ว
									</Button>
								{/if}
								{#if failures.length > 0}
									<Button variant="ghost" size="sm" onclick={() => openResults(log, 'failed')}>
										<AlertCircle class="mr-1.5 h-4 w-4" aria-hidden="true" /> ดูข้อผิดพลาด
									</Button>
								{/if}
								{#if success.length === 0 && failures.length === 0}
									<span class="text-sm text-slate-500">ไม่มีรายละเอียด</span>
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

{#if selectedLog}
	<Dialog.Root bind:open={resultsDialogOpen}>
		<Dialog.Content class="max-h-[90vh] overflow-y-auto shadow-md sm:max-w-5xl">
			<Dialog.Header>
				<Dialog.Title class="text-xl font-bold text-slate-900">
					{resultFilter === 'success' ? 'ศูนย์ที่นำเข้าแล้ว' : 'รายการที่ผิดพลาด'}
				</Dialog.Title>
				<Dialog.Description>
					{selectedLog.filename} · {formatTime(selectedLog.finished_at)} · โดย {selectedLog.imported_by}
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap gap-2" aria-label="ตัวกรองผลลัพธ์">
					{#if createdRows(selectedLog.results).length > 0}
						<Button
							variant={resultFilter === 'success' ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => (resultFilter = 'success')}
						>
							ศูนย์ที่นำเข้าแล้ว ({createdRows(selectedLog.results).length})
						</Button>
					{/if}
					{#if failedRows(selectedLog.results).length > 0}
						<Button
							variant={resultFilter === 'failed' ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => (resultFilter = 'failed')}
						>
							รายการผิดพลาด ({failedRows(selectedLog.results).length})
						</Button>
					{/if}
				</div>
				<p class="text-xs text-slate-500">ตารางหลักแสดงเฉพาะสรุป ไม่แสดงรายชื่อศูนย์</p>
			</div>

			<div class="overflow-x-auto rounded-xl border border-slate-200/80">
				<Table.Root class="min-w-[680px]">
					<Table.Header>
						<Table.Row class="bg-slate-50/80 hover:bg-slate-50/80">
							<Table.Head class="w-16 text-center">แถว</Table.Head>
							<Table.Head>ชื่อศูนย์พักพิง</Table.Head>
							<Table.Head>สถานะ / รายละเอียด</Table.Head>
							{#if resultFilter === 'success'}<Table.Head class="text-right">ศูนย์</Table.Head>{/if}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each selectedRows as row (row.row)}
							<Table.Row>
								<Table.Cell class="text-center text-slate-600 tabular-nums">{row.row}</Table.Cell>
								<Table.Cell class="min-w-56 font-medium whitespace-normal text-slate-900">
									{row.name ?? 'ไม่ระบุชื่อ'}
								</Table.Cell>
								<Table.Cell class="min-w-64 whitespace-normal">
									{#if resultFilter === 'success'}
										<Badge
											variant="outline"
											class="border-emerald-200 bg-emerald-50 text-emerald-900"
										>
											{resultStatusLabel(row)}
										</Badge>
									{:else}
										<Badge variant="destructive">{resultStatusLabel(row)}</Badge>
										<p class="mt-2 text-sm text-red-700">{resultErrorText(row)}</p>
									{/if}
								</Table.Cell>
								{#if resultFilter === 'success'}
									<Table.Cell class="text-right">
										{#if row.code || row.existing_code}
											<Button
												variant="link"
												size="sm"
												href={`${resolvedBasePath}/edit/${encodeURIComponent(row.code ?? row.existing_code ?? '')}`}
											>
												{row.code ?? row.existing_code}
												<ExternalLink class="ml-1 h-3.5 w-3.5" aria-hidden="true" />
											</Button>
										{:else}—{/if}
									</Table.Cell>
								{/if}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<p class="text-xs text-slate-500">รายละเอียดรายแถวแสดงสูงสุด 200 รายการต่อประวัติ</p>
		</Dialog.Content>
	</Dialog.Root>
{/if}
