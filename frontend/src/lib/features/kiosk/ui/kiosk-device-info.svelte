<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Info from '@lucide/svelte/icons/info';
	import Printer from '@lucide/svelte/icons/printer';
	import { Button } from '$lib/components/ui/button/index.js';
	import { KIOSK_SCREENS } from '$lib/features/shared';
	import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';
	import { DeviceInfoSession } from '../application/device-info.svelte';
	import { prepareKioskQrImage, printKioskQrLabels } from '../application/kiosk-label-print';
	import { TestPrint } from '../application/test-print.svelte';
	import { fetchKioskDeviceInfo } from '../data/kiosk-device-info.api';
	import { fetchKioskHostInfo } from '../data/kiosk-host-info.api';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';
	import KioskLabelSheet from './kiosk-label-sheet.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';

	const session = untrack(
		() =>
			new DeviceInfoSession({
				fetchDeviceInfo: (pin) => fetchKioskDeviceInfo(pin),
				fetchHostInfo: () => fetchKioskHostInfo(),
				isBusy: () => testPrint.busy
			})
	);

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

	/** The panel is already behind the staff PIN: print at once, and keep it open meanwhile. */
	async function printTestLabel(): Promise<void> {
		session.touch();
		await testPrint.print();
		session.touch();
	}

	const id = $props.id();
	const titleId = `${id}-title`;

	onMount(() => () => {
		session.destroy();
		testPrint.destroy();
	});

	/** Staff asked to see the PIN; every open starts masked again (see `onverified`). */
	let pinVisible = $state(false);

	const info = $derived(session.info);
	const host = $derived(session.host);

	const shelterLabel = $derived(
		info
			? info.shelterName === info.shelterCode
				? info.shelterName
				: `${info.shelterName} (${info.shelterCode})`
			: ''
	);

	const pinLabel = $derived(
		!info ? '' : info.staffPin.isDefault ? 'ยังเป็นค่าเริ่มต้น' : 'ตั้งแล้ว'
	);

	const pinUpdated = $derived.by(() => {
		const pin = info?.staffPin;
		if (!pin?.updatedAt) return null;
		const at = new Date(pin.updatedAt);
		if (Number.isNaN(at.getTime())) return null;
		const when = at.toLocaleString(DISPLAY_LOCALE, {
			timeZone: DISPLAY_TIME_ZONE,
			dateStyle: 'medium',
			timeStyle: 'short'
		});
		return `อัปเดต ${when}`;
	});

	/** The panel is modal: keyboard focus starts inside it, on the safe way out. */
	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	let panel = $state<HTMLElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);

	/**
	 * Whichever way the panel goes away (ปิด, Esc, idle timeout) focus goes back to the ℹ button.
	 * It is still disabled in the same flush as the teardown, so wait a tick before focusing.
	 */
	function restoreFocusOnClose(): () => void {
		return () => {
			void tick().then(() => trigger?.focus());
		};
	}

	/** Keep Tab / Shift+Tab inside the modal panel: wrap at both ends, pull stray focus back in. */
	function trapTab(event: KeyboardEvent): void {
		if (!panel) return;
		const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled)')];
		const first = controls.at(0);
		const last = controls.at(-1);
		if (!first || !last) return;
		const active = document.activeElement;
		const edge = event.shiftKey ? first : last;
		if (active && panel.contains(active) && active !== edge) return;
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') return trapTab(event);
		if (event.key !== 'Escape') return;
		event.preventDefault();
		// Same as the close button: the panel stays open until a test print finishes.
		if (testPrint.busy) return;
		session.close();
	}
</script>

<!-- Only while the panel shows (any tap restarts the idle clock): the PIN panel owns Esc before that. -->
<svelte:window
	onkeydown={session.shown ? handleKeydown : undefined}
	onpointerdown={session.shown ? () => session.touch() : undefined}
/>

<!-- Staff only: small and out of the way; the PIN is asked first. -->
<button
	type="button"
	aria-label="ข้อมูลเครื่อง"
	data-testid="kiosk-device-info-button"
	bind:this={trigger}
	disabled={session.phase !== 'idle'}
	onclick={() => session.open()}
	class="no-print fixed right-3 bottom-[calc(var(--testing-banner-height)+0.75rem)] z-30 flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-500 shadow-2xs hover:bg-white hover:text-[#0A2647] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50 kiosk-portrait:size-14 kiosk-compact:right-2 kiosk-compact:bottom-[calc(var(--testing-banner-height)+0.25rem)]"
>
	<Info class="size-5 kiosk-portrait:size-7" aria-hidden="true" />
</button>

{#if session.pinOpen}
	<div
		class="no-print fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[#F8FAFC] px-3 py-2 kiosk-portrait:px-6 kiosk-portrait:py-6"
		role="dialog"
		aria-modal="true"
		aria-label="PIN เจ้าหน้าที่สำหรับดูข้อมูลเครื่อง"
		data-testid="kiosk-device-info-pin"
	>
		<!-- my-auto: centred on the screen, yet still scrolls from the top when it does not fit. -->
		<div class="my-auto w-full">
			<KioskStaffPinEntry
				headingTag="h2"
				description="กรอก PIN 6 หลักเพื่อดูข้อมูลเครื่อง"
				verify={(pin) => session.verify(pin)}
				onverified={() => {
					pinVisible = false;
					session.pinVerified();
				}}
				oncancel={() => session.pinCancelled()}
			/>
		</div>
	</div>
{/if}

{#if session.shown && info}
	<div
		class="no-print fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[#F8FAFC] px-3 py-2 kiosk-portrait:px-6 kiosk-portrait:py-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		data-testid="kiosk-device-info-panel"
		bind:this={panel}
		{@attach restoreFocusOnClose}
	>
		<div
			class="my-auto flex w-full max-w-lg flex-col gap-4 self-center rounded-3xl border border-slate-200 bg-white p-6 kiosk-portrait:max-w-3xl kiosk-portrait:gap-6 kiosk-portrait:p-8 kiosk-compact:max-w-3xl kiosk-compact:gap-3 kiosk-compact:p-4"
		>
			<h2
				id={titleId}
				class="text-center text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
			>
				ข้อมูลเครื่อง
			</h2>

			<dl
				class="divide-y divide-slate-100 text-base kiosk-portrait:text-2xl kiosk-compact:grid kiosk-compact:grid-cols-2 kiosk-compact:gap-x-6 kiosk-compact:divide-y-0 kiosk-compact:text-sm"
			>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">ชื่อเครื่อง</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{info.name}
						<span
							class="block text-sm font-normal text-slate-500 tabular-nums kiosk-portrait:text-lg"
							>Device ID {info.deviceId}</span
						>
					</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">Hostname</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{host?.hostname ?? '—'}</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">IP address</dt>
					<dd class="text-right font-semibold text-[#0A2647] tabular-nums">
						{#each host?.ips ?? [] as ip (ip)}
							<span class="block">{ip}</span>
						{:else}
							—
						{/each}
					</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">ศูนย์พักพิง</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{shelterLabel}</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">จุดบริการ</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{info.stationName}</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">PIN เจ้าหน้าที่</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{#if session.pin}
							<span class="flex items-center justify-end gap-2">
								<span data-testid="kiosk-device-info-pin-value" class="tabular-nums">
									{pinVisible ? session.pin : '••••••'}
								</span>
								<button
									type="button"
									aria-label={pinVisible ? 'ซ่อน PIN' : 'แสดง PIN'}
									aria-pressed={pinVisible}
									onclick={() => (pinVisible = !pinVisible)}
									class="flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-[#0A2647] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none kiosk-portrait:size-14"
								>
									{#if pinVisible}
										<EyeOff class="size-5 kiosk-portrait:size-7" aria-hidden="true" />
									{:else}
										<Eye class="size-5 kiosk-portrait:size-7" aria-hidden="true" />
									{/if}
								</button>
							</span>
						{/if}
						{pinLabel}
						{#if pinUpdated}
							<span class="block text-sm font-normal text-slate-500 kiosk-portrait:text-lg"
								>{pinUpdated}</span
							>
						{/if}
					</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">Banner group</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{info.bannerGroup?.name ?? 'ไม่ได้อยู่ในกลุ่ม'}
					</dd>
				</div>
				<div
					class="flex justify-between gap-4 py-2 kiosk-portrait:py-4 kiosk-compact:border-b kiosk-compact:border-slate-100 kiosk-compact:py-1.5"
				>
					<dt class="text-slate-600">หน้าจอ</dt>
					<dd
						class="text-right font-semibold text-[#0A2647]"
						data-testid="kiosk-device-info-screen"
					>
						{KIOSK_SCREENS[info.screenType].label} · {KIOSK_SCREENS[info.screenType].size}
					</dd>
				</div>
			</dl>

			{#if testPrint.phase === 'error'}
				<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert" class="mx-0 max-w-none">
					<span>ทดสอบการพิมพ์ไม่สำเร็จ: {testPrint.error}</span>
				</KioskInlineAlert>
			{/if}

			<div class="flex gap-3">
				<Button
					type="button"
					variant="outline"
					size="lg"
					data-testid="kiosk-device-info-test-print"
					disabled={testPrint.busy}
					onclick={() => void printTestLabel()}
					class="min-h-12 flex-1 gap-2 text-base font-bold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-11"
				>
					<Printer class="size-5 kiosk-portrait:size-7" aria-hidden="true" />
					ทดสอบการพิมพ์
				</Button>
				<Button
					type="button"
					size="lg"
					disabled={testPrint.busy}
					onclick={() => session.close()}
					{@attach focusOnMount}
					class="min-h-12 flex-1 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-11"
				>
					ปิด
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if testPrint.labels.length > 0}
	<KioskLabelSheet labels={testPrint.labels} />
{/if}
{#if testPrint.phase === 'printing' || testPrint.phase === 'done'}
	<KioskPrintStatus phase={testPrint.phase} count={1} />
{/if}
