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
		return results.filter((r) => r.status !== 'created');
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
						<Badge variant="secondary">สำเร็จ {log.success_count}</Badge>
						{#if log.error_count > 0}
							<Badge variant="destructive">ล้มเหลว {log.error_count}</Badge>
						{/if}
						<span class="text-xs text-muted-foreground">จาก {log.total_rows} แถว</span>
					</div>
				</div>

				{#if createdRows(log.results).length > 0}
					<div class="mt-3 border-t border-border pt-3">
						<p class="mb-2 text-xs font-medium text-muted-foreground">ศูนย์ที่นำเข้าสำเร็จ</p>
						<ul class="flex flex-wrap gap-2">
							{#each createdRows(log.results) as row (row.row)}
								<li>
									<a
										href={resolve(
											`/back-office/shelters/edit/${encodeURIComponent(row.code ?? '')}`
										)}
										class="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-sm transition-colors hover:bg-muted"
									>
										<span class="font-medium">{row.code}</span>
										{#if row.name}<span class="text-muted-foreground">· {row.name}</span>{/if}
										<ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if failedRows(log.results).length > 0}
					<ul class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
						{#each failedRows(log.results) as row (row.row)}
							<li>
								<span class="font-medium">แถว {row.row}</span>
								{#if row.name}<span class="text-muted-foreground"> · {row.name}</span>{/if}
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
