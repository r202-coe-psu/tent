<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Printer from '@lucide/svelte/icons/printer';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import { useScannerClientPrinter } from '../application/scanner-client-printer';
	import { printOnScannerClient, ScannerClientPrintError } from '../data/scanner-client-print.api';
	import { canPrintSource } from '../domain/print-permission';
	import { ReportedRenderError } from '../domain/reported-error';
	import {
		SCANNER_CLIENT_PRINT_I18N,
		scannerClientPrintErrorMessage
	} from '../domain/scanner-client-print.i18n';

	let {
		shelterCode,
		labelCount,
		source,
		renderLabels,
		buttonClass,
		disabled = false,
		printing: running = $bindable(false)
	}: {
		shelterCode: string;
		labelCount: number;
		source: 'walk_in' | 'evacuee_qr';
		/** Same callback as `PrintLabelsButton`: may issue QRs, throws `ReportedRenderError` after its own toast. */
		renderLabels: () => Promise<string[]>;
		buttonClass?: string;
		/** e.g. while the print-server button is printing, so one click never prints twice. */
		disabled?: boolean;
		/** True while printing; bind it to keep the host open meanwhile. */
		printing?: boolean;
	} = $props();

	const t = $derived(getTranslation(SCANNER_CLIENT_PRINT_I18N, languageStore.current));

	// Same roles as the print-server button (FR-29a); without them nothing is shown.
	const canPrint = $derived(canPrintSource(authStore.user?.roles ?? [], shelterCode, source));
	const printerQuery = useScannerClientPrinter(() => canPrint);
	// Only inside the scanner client with a printer on this PC; a plain browser never sees the button.
	const printer = $derived(canPrint ? (printerQuery.data ?? null) : null);

	async function print() {
		if (running || !printer) return;
		const name = printer.name;
		running = true;
		try {
			let labels: string[];
			try {
				labels = await renderLabels();
			} catch (error) {
				if (!(error instanceof ReportedRenderError)) toast.error(t.renderFailed);
				return;
			}
			try {
				const printed = await printOnScannerClient(labels);
				toast.success(t.printed(printed, name));
			} catch (error) {
				const failure =
					error instanceof ScannerClientPrintError
						? error
						: new ScannerClientPrintError('connection', 0);
				toast.error(
					scannerClientPrintErrorMessage(failure.code, name, failure.printed, languageStore.current)
				);
				void printerQuery.refetch();
			}
		} finally {
			running = false;
		}
	}
</script>

{#if printer}
	<Button
		variant="outline"
		class={buttonClass}
		disabled={running || disabled}
		aria-busy={running}
		onclick={print}
	>
		{#if running}
			<LoaderCircle class="size-4 animate-spin" />
		{:else}
			<Printer class="size-4" />
		{/if}
		{t.printHere(labelCount, printer.name)}
	</Button>
{/if}
