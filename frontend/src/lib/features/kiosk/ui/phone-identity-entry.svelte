<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Search from '@lucide/svelte/icons/search';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import KioskNumpad from './kiosk-numpad.svelte';
	import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
	import { formatPhoneForDisplay, normalizeKioskPhone } from '../domain/phone';
	import type { GateInput } from '../data/kiosk-check-in.api';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';

	interface Props {
		contextQuery: string;
		displayShelterCode: string;
	}

	let { contextQuery, displayShelterCode }: Props = $props();
	let phone = $state('');
	let gate = $state<GateInput | null>(null);
	const isValid = $derived(normalizeKioskPhone(phone) !== null && phone.startsWith('0'));
	const displayPhone = $derived(formatPhoneForDisplay(phone));
	const homeUrl = $derived(resolve(`/kiosk${contextQuery as `?${string}`}`));
	const phoneUrl = $derived(resolve(`/kiosk/phone${contextQuery as `?${string}`}`));
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, () => {
		resetEntry();
		void goto(resolve(`/kiosk${contextQuery as `?${string}`}`));
	});

	function startLookup(): void {
		if (!isValid || gate) return;
		gate = { source: 'phone', phone };
		phone = '';
	}

	function resetEntry(): void {
		gate = null;
		phone = '';
	}

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}

	function handlePrintBusyChange(busy: boolean): void {
		idleTimeout.setPaused(busy);
	}

	onMount(() => {
		idleTimeout.start();
		return () => idleTimeout.stop();
	});
</script>

<svelte:head>
	<title>ค้นหาด้วยเบอร์โทรศัพท์ — SmartShelter Kiosk</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#if gate}
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		{displayShelterCode}
		backHref={phoneUrl}
		onprintbusychange={handlePrintBusyChange}
		onreset={resetEntry}
	/>
{:else}
	<div class="phone-entry-page mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
		<KioskCheckInWizard currentStep={2} step2Label="กรอกเบอร์" />
		<div class="phone-entry-back-row flex justify-start">
			<Button
				href={homeUrl}
				variant="ghost"
				aria-label="กลับหน้าเริ่มต้น"
				class="min-h-11 gap-2 px-3 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			>
				<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
			</Button>
		</div>
		<section
			class="phone-entry mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-2"
			aria-label="ค้นหาด้วยเบอร์โทรศัพท์"
		>
			<header class="text-center">
				<p class="mt-1 text-base text-slate-700">ใช้เบอร์ที่กรอกตอนลงทะเบียนล่วงหน้า</p>
			</header>

			<output
				class="flex min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-2xl font-bold text-slate-950 tabular-nums"
				aria-label="เบอร์โทรศัพท์ที่กรอก"
				aria-live="polite"
			>
				{displayPhone || 'เบอร์โทรศัพท์'}
			</output>

			<div class="phone-entry-numpad flex min-h-0 flex-1 flex-col">
				<KioskNumpad bind:value={phone} maxLength={10} onsubmit={startLookup} />
			</div>

			<div class="phone-entry-search">
				<Button
					type="button"
					disabled={!isValid}
					onclick={startLookup}
					class="min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
				>
					<Search class="h-5 w-5" aria-hidden="true" />ค้นหา
				</Button>
			</div>
			<p class="phone-entry-hint text-center text-sm leading-snug text-slate-600">
				ไม่มีเบอร์? ใช้ QR หรือบัตรประชาชน หรือติดต่อเจ้าหน้าที่
			</p>
		</section>
	</div>
{/if}

<style>
	.phone-entry-numpad :global([role='group']) {
		flex: 1;
		grid-template-rows: repeat(4, minmax(3rem, 1fr));
	}

	.phone-entry-numpad :global(button) {
		height: 100%;
	}

	@media (max-height: 650px) {
		.phone-entry {
			gap: 0.25rem;
		}

		.phone-entry header p {
			margin-top: 0;
			font-size: 0.875rem;
			line-height: 1.25;
		}

		.phone-entry output {
			min-height: 2.75rem;
			font-size: 1.25rem;
		}

		.phone-entry-numpad :global(button) {
			min-height: 3rem;
			height: 100%;
		}

		.phone-entry-numpad :global(button[aria-label^='ตัวเลข']) {
			font-size: 1.5rem;
		}

		.phone-entry-search :global(button) {
			min-height: 2.75rem;
		}

		.phone-entry-hint {
			font-size: 0.75rem;
			line-height: 1.2;
		}
	}
</style>
