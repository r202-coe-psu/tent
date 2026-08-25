<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { useImportLogs } from '../application/queries';
	import type { ImportRowResult } from '../domain/import-log';

	const logsQuery = useImportLogs();
	const logs = $derived(logsQuery.data ?? []);

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	}

	function createdRows(results: ImportRowResult[]): ImportRowResult[] {
		return results.filter((r) => r.status === 'created');
	}

	function failedRows(results: ImportRowResult[]): ImportRowResult[] {
		return results.filter((r) => r.status === 'validation_error' || r.status === 'server_error');
	}

	function skippedRows(results: ImportRowResult[]): ImportRowResult[] {
		return results.filter((r) => r.status === 'skipped_duplicate');
	}
</script>

<div class="flex flex-col gap-4">
	{#if logsQuery.isLoading}
		<p class="py-6 text-center text-sm text-muted-foreground">กำลังโหลดประวัติ...</p>
	{:else if logs.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">ยังไม่มีประวัติการนำเข้า</p>
	{:else}
		{#each logs as log (log._id)}
			<div class="rounded-xl border border-border p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p class="font-medium text-foreground">{log.filename}</p>
						<p class="text-xs text-muted-foreground">
							{formatTime(log.finished_at)} · โดย {log.imported_by}
						</p>
					</div>
					<div class="flex items-center gap-2">
						<Badge variant="secondary">
							สำเร็จ {log.success_count} ครัวเรือน · {log.created_people} คน
						</Badge>
						{#if log.skipped_count > 0}
							<Badge variant="outline" class="border-amber-300 text-amber-700">
								ข้าม {log.skipped_count}
							</Badge>
						{/if}
						{#if log.error_count > 0}
							<Badge variant="destructive">ล้มเหลว {log.error_count}</Badge>
						{/if}
						<span class="text-xs text-muted-foreground">จาก {log.total_rows} ครัวเรือน</span>
					</div>
				</div>

				{#if createdRows(log.results).length > 0}
					<div class="mt-3 border-t border-border pt-3">
						<p class="mb-2 text-xs font-medium text-muted-foreground">ครัวเรือนที่นำเข้าสำเร็จ</p>
						<ul class="flex flex-wrap gap-2">
							{#each createdRows(log.results) as row (row.row)}
								<li>
									{#if row.household_id}
										<a
											href={resolve(`/back-office/households/edit/${row.household_id}`)}
											class="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-sm transition-colors hover:bg-muted"
										>
											<span class="font-medium">{row.label ?? `แถว ${row.row}`}</span>
											<span class="text-muted-foreground">
												· {(row.created_members ?? 0) + 1} คน
											</span>
											<ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
										</a>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-sm"
										>
											<span class="font-medium">{row.label ?? `แถว ${row.row}`}</span>
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if skippedRows(log.results).length > 0}
					<ul class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
						{#each skippedRows(log.results) as row (row.row)}
							<li>
								<span class="font-medium">แถว {row.row}</span>
								{#if row.label}<span class="text-muted-foreground"> · {row.label}</span>{/if}
								<span class="text-amber-700">— ข้าม เพราะหัวหน้าครัวเรือนมีอยู่ในศูนย์นี้แล้ว</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if failedRows(log.results).length > 0}
					<ul class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
						{#each failedRows(log.results) as row (row.row)}
							<li>
								<span class="font-medium">แถว {row.row}</span>
								{#if row.label}<span class="text-muted-foreground"> · {row.label}</span>{/if}
								<span class="text-destructive">
									— {(row.errors ?? []).map((e) => `${e.column}: ${e.message}`).join('; ')}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	{/if}
</div>
