<script lang="ts">
	/**
	 * Back-office printer table: state only (online, queue, last job, secret prefix). Every action
	 * lives in the "จัดการ" dialog.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { languageStore } from '$lib/stores/language.svelte';
	import { cn } from '$lib/utils/shadcn';
	import { getTranslation } from '$lib/utils/i18n';
	import { formatThaiShortDate } from '$lib/utils/date';
	import type { PrinterAdminItem, PrinterSecretResponse } from '../domain/print-device.schema';
	import { PRINTERS_I18N } from '../domain/printers.i18n';
	import EditPrinterDialog from './edit-printer-dialog.svelte';

	let {
		printers = [],
		onrotated
	}: {
		printers: readonly PrinterAdminItem[];
		/** A secret was rotated in the edit dialog: the page shows it once. */
		onrotated?: (result: PrinterSecretResponse) => void;
	} = $props();

	const lang = $derived(languageStore.current);
	const t = $derived(getTranslation(PRINTERS_I18N, lang));
	const a = $derived(t.admin);

	let editOpen = $state(false);
	let editDeviceId = $state<string | null>(null);
	/** Read from the live list, so the dialog reflects a refetch. */
	const editPrinter = $derived(printers.find((p) => p.device_id === editDeviceId) ?? null);
	/** Bumped on every open: the dialog remounts, so a cancelled edit never comes back. */
	let editSession = $state(0);

	function handleEdit(printer: PrinterAdminItem) {
		editDeviceId = printer.device_id;
		editSession += 1;
		editOpen = true;
	}

	function lastSeenText(lastSeen: string | null): string {
		return lastSeen ? formatThaiShortDate(lastSeen) || lastSeen : a.neverSeen;
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-500">
			<tr>
				<th class="px-6 py-3.5">{a.columns.printer}</th>
				<th class="px-6 py-3.5">{a.columns.station}</th>
				<th class="px-6 py-3.5">{a.columns.status}</th>
				<th class="px-6 py-3.5">{a.columns.queue}</th>
				<th class="px-6 py-3.5">{a.columns.lastJob}</th>
				<th class="px-6 py-3.5 text-right"><span class="sr-only">{a.columns.manage}</span></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-slate-200/70">
			{#if printers.length === 0}
				<tr>
					<td colspan="6" class="px-6 py-12 text-center text-slate-500">
						<Printer class="mx-auto mb-2 h-8 w-8 text-slate-300" />
						<p>{a.empty}</p>
						<p class="text-xs">{a.emptyHint}</p>
					</td>
				</tr>
			{:else}
				{#each printers as printer (printer.id)}
					<tr class="transition-colors hover:bg-slate-50/70">
						<td class="px-6 py-4">
							<p class="font-semibold text-slate-900">{printer.name}</p>
							<p class="text-xs text-slate-500 tabular-nums">{printer.device_id}</p>
							<p class="font-mono text-xs text-slate-400">
								{a.secretPrefix(printer.secret_prefix)}
							</p>
						</td>
						<td class="px-6 py-4">
							<span class="font-semibold text-slate-900">{printer.shelter_code}</span>
							<span class="block text-xs text-slate-500">{printer.station ?? a.noStation}</span>
						</td>
						<td class="px-6 py-4">
							<div class="flex flex-wrap items-center gap-1.5">
								<span
									class={cn(
										'text-xs font-semibold',
										printer.online ? 'text-emerald-700' : 'text-muted-foreground'
									)}
								>
									{printer.online ? `● ${t.online}` : `● ${t.offline}`}
								</span>
								{#if printer.status === 'inactive'}
									<span class="badge-muted">{a.inactive}</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-slate-500">{lastSeenText(printer.last_seen_at)}</p>
						</td>
						<td class="px-6 py-4 text-xs text-slate-700">{a.queueState[printer.queue_state]}</td>
						<td class="px-6 py-4 text-xs text-slate-700">
							{#if printer.last_job}
								{@const known = Object.hasOwn(a.jobStatus, printer.last_job.status)}
								{known
									? a.jobStatus[printer.last_job.status as keyof typeof a.jobStatus]
									: printer.last_job.status}
							{:else}
								{a.noJob}
							{/if}
						</td>
						<td class="px-6 py-4 text-right">
							<Button
								variant="outline"
								class="min-h-11 gap-1.5"
								onclick={() => handleEdit(printer)}
							>
								<Settings2 class="h-4 w-4" />
								{a.manage}
								<span class="sr-only">{a.manageSr(printer.name)}</span>
							</Button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

{#if editPrinter}
	{#key editSession}
		<EditPrinterDialog bind:open={editOpen} printer={editPrinter} {onrotated} />
	{/key}
{/if}
