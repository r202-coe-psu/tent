<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Info from '@lucide/svelte/icons/info';
	import { Button } from '$lib/components/ui/button/index.js';
	import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';
	import { DeviceInfoSession } from '../application/device-info.svelte';
	import { fetchKioskDeviceInfo } from '../data/kiosk-device-info.api';
	import { fetchKioskHostInfo } from '../data/kiosk-host-info.api';
	import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';

	const session = untrack(
		() =>
			new DeviceInfoSession({
				fetchDeviceInfo: (pin) => fetchKioskDeviceInfo(pin),
				fetchHostInfo: () => fetchKioskHostInfo()
			})
	);

	const id = $props.id();
	const titleId = `${id}-title`;

	onMount(() => () => session.destroy());

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
		!info?.staffPin.set ? 'ยังไม่ตั้ง' : info.staffPin.isDefault ? 'ยังเป็นค่าเริ่มต้น' : 'ตั้งแล้ว'
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
		return pin.updatedBy ? `อัปเดต ${when} โดย ${pin.updatedBy}` : `อัปเดต ${when}`;
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		session.close();
	}
</script>

<!-- Only while the panel shows (any tap restarts the idle clock): the PIN panel owns Esc before that. -->
<svelte:window
	onkeydown={session.shown ? handleKeydown : undefined}
	onpointerdown={session.shown ? () => session.touch() : undefined}
/>

<!-- Staff only: small and out of the way, left of the test-print button; the PIN is asked first. -->
<button
	type="button"
	aria-label="ข้อมูลเครื่อง"
	data-testid="kiosk-device-info-button"
	disabled={session.phase !== 'idle'}
	onclick={() => session.open()}
	class="no-print fixed right-[3.75rem] bottom-[calc(var(--testing-banner-height)+0.75rem)] z-30 flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-500 shadow-2xs hover:bg-white hover:text-[#0A2647] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50 kiosk-portrait:right-[4.75rem] kiosk-portrait:size-14 kiosk-compact:right-[3.5rem] kiosk-compact:bottom-[calc(var(--testing-banner-height)+0.25rem)]"
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
				onverified={() => session.pinVerified()}
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
	>
		<div
			class="my-auto flex w-full max-w-lg flex-col gap-4 self-center rounded-3xl border border-slate-200 bg-white p-6"
		>
			<h2
				id={titleId}
				class="text-center text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl"
			>
				ข้อมูลเครื่อง
			</h2>

			<dl class="divide-y divide-slate-100 text-base kiosk-portrait:text-xl">
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">ชื่อเครื่อง</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{info.name}
						<span class="block text-sm font-normal text-slate-500 tabular-nums"
							>Device ID {info.deviceId}</span
						>
					</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">Hostname</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{host?.hostname ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">IP address</dt>
					<dd class="text-right font-semibold text-[#0A2647] tabular-nums">
						{#each host?.ips ?? [] as ip (ip)}
							<span class="block">{ip}</span>
						{:else}
							—
						{/each}
					</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">ศูนย์พักพิง</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{shelterLabel}</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">จุดบริการ</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{info.stationName}</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">PIN เจ้าหน้าที่</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{pinLabel}
						{#if pinUpdated}
							<span class="block text-sm font-normal text-slate-500">{pinUpdated}</span>
						{/if}
					</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">Banner group</dt>
					<dd class="text-right font-semibold text-[#0A2647]">
						{info.bannerGroup?.name ?? 'ไม่ได้อยู่ในกลุ่ม'}
					</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-slate-600">หน้าจอ</dt>
					<dd class="text-right font-semibold text-[#0A2647]">{info.screenType}</dd>
				</div>
			</dl>

			<Button
				type="button"
				size="lg"
				onclick={() => session.close()}
				class="min-h-12 w-full bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
			>
				ปิด
			</Button>
		</div>
	</div>
{/if}
