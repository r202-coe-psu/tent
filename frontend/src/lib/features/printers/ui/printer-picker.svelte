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

	// Roving tabindex: one radio in the tab order. Arrows only move focus — picking a printer
	// closes the picker, so selection stays on Enter / Space / click.
	const tabStopId = $derived(
		printers.some((p) => p.id === selectedId) ? selectedId : (printers[0]?.id ?? null)
	);

	const STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

	function handleKeydown(event: KeyboardEvent) {
		const group = event.currentTarget as HTMLElement;
		const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
		const current = radios.indexOf(document.activeElement as HTMLElement);
		if (current === -1) return;
		let next: number;
		if (event.key in STEP) next = (current + STEP[event.key] + radios.length) % radios.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = radios.length - 1;
		else return;
		event.preventDefault();
		radios[next].focus();
	}
</script>

<div
	role="radiogroup"
	tabindex="-1"
	aria-label={t.choosePrinter}
	class="flex flex-col gap-1.5"
	onkeydown={handleKeydown}
>
	{#each printers as printer (printer.id)}
		<button
			type="button"
			role="radio"
			aria-checked={printer.id === selectedId}
			tabindex={printer.id === tabStopId ? 0 : -1}
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
