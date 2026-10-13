<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Printer from '@lucide/svelte/icons/printer';
	import X from '@lucide/svelte/icons/x';
	import { prepareKioskQrImage, printKioskQrLabels } from '../application/kiosk-label-print';
	import { TestPrint } from '../application/test-print.svelte';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';
	import KioskLabelSheet from './kiosk-label-sheet.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';

	/** No scanner client (dev browser / browser print mode): print the CSS label instead. */
	async function browserPrint(): Promise<void> {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		window.print();
	}

	const testPrint = untrack(
		() =>
			new TestPrint({
				prepareQrImage: prepareKioskQrImage,
				printLabels: printKioskQrLabels,
				fallbackPrint: browserPrint
			})
	);

	onMount(() => () => testPrint.destroy());
</script>

<!-- Staff only: small and out of the way; the PIN is asked before anything prints. -->
<button
	type="button"
	aria-label="ทดสอบการพิมพ์"
	data-testid="kiosk-test-print-button"
	disabled={testPrint.busy}
	onclick={() => testPrint.open()}
	class="no-print fixed right-3 bottom-[calc(var(--testing-banner-height)+0.75rem)] z-30 flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-500 shadow-2xs hover:bg-white hover:text-[#0A2647] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50 kiosk-portrait:size-14 kiosk-compact:right-2 kiosk-compact:bottom-[calc(var(--testing-banner-height)+0.25rem)]"
>
	<Printer class="size-5 kiosk-portrait:size-7" aria-hidden="true" />
</button>

{#if testPrint.phase === 'error'}
	<div
		class="no-print fixed right-3 bottom-[calc(var(--testing-banner-height)+4.5rem)] left-3 z-30 flex justify-end kiosk-compact:bottom-[calc(var(--testing-banner-height)+3.5rem)]"
	>
		<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert" class="mx-0 max-w-md">
			<span>ทดสอบการพิมพ์ไม่สำเร็จ: {testPrint.error}</span>
			<button
				type="button"
				aria-label="ปิดข้อความ"
				onclick={() => testPrint.dismiss()}
				class="ml-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
			>
				<X class="size-4" aria-hidden="true" />
			</button>
		</KioskInlineAlert>
	</div>
{/if}

{#if testPrint.pinOpen}
	<div
		class="no-print fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[#F8FAFC] px-3 py-2 kiosk-portrait:px-6 kiosk-portrait:py-6"
		role="dialog"
		aria-modal="true"
		aria-label="PIN เจ้าหน้าที่สำหรับทดสอบการพิมพ์"
		data-testid="kiosk-test-print-pin"
	>
		<!-- my-auto: centred on the screen, yet still scrolls from the top when it does not fit. -->
		<div class="my-auto w-full">
			<KioskStaffPinEntry
				headingTag="h2"
				description="กรอก PIN 6 หลักเพื่อทดสอบการพิมพ์"
				onverified={() => void testPrint.pinVerified()}
				oncancel={() => testPrint.pinCancelled()}
			/>
		</div>
	</div>
{/if}

{#if testPrint.labels.length > 0}
	<KioskLabelSheet labels={testPrint.labels} />
{/if}
{#if testPrint.phase === 'printing' || testPrint.phase === 'done'}
	<KioskPrintStatus phase={testPrint.phase} count={1} />
{/if}
