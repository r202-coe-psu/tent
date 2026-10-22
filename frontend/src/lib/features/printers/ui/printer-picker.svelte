<script lang="ts">
	import { languageStore } from '$lib/stores/language.svelte';
	import { cn } from '$lib/utils/shadcn';
	import { getTranslation } from '$lib/utils/i18n';
	import type { PrinterSummary } from '../domain/print-device.schema';
	import { PRINTERS_I18N } from '../domain/printers.i18n';

	let {
		printers,
		selectedId = null,
		onSelect
	}: {
		printers: readonly PrinterSummary[];
		selectedId?: string | null;
		onSelect: (printerId: string) => void;
	} = $props();

	const t = $derived(getTranslation(PRINTERS_I18N, languageStore.current));
</script>

<div role="radiogroup" aria-label={t.choosePrinter} class="flex flex-col gap-1.5">
	{#each printers as printer (printer.id)}
		<button
			type="button"
			role="radio"
			aria-checked={printer.id === selectedId}
			class={cn(
				'flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm',
				printer.id === selectedId ? 'border-primary bg-primary/5' : 'border-border bg-background'
			)}
			onclick={() => onSelect(printer.id)}
		>
			<span class="font-medium text-foreground">{printer.name}</span>
			<span
				class={cn(
					'flex items-center gap-1.5 text-xs',
					printer.online ? 'text-emerald-700' : 'text-muted-foreground'
				)}
			>
				<span aria-hidden="true">●</span>
				{printer.online ? t.online : t.offline}
			</span>
		</button>
	{/each}
</div>
