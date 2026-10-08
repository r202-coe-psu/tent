<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import Search from '@lucide/svelte/icons/search';
	import KioskBackButton from './kiosk-back-button.svelte';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';
	import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
	import { formatPhoneForDisplay, isKioskPhoneSubmittable, phoneEntryHint } from '../domain/phone';
	import type { GateInput } from '../data/kiosk-check-in.api';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';

	interface Props {
		contextQuery: string;
		displayShelterCode: string;
	}

	let { contextQuery, displayShelterCode }: Props = $props();
	let phone = $state('');
	let gate = $state<GateInput | null>(null);
	const isValid = $derived(isKioskPhoneSubmittable(phone));
	const entryHint = $derived(phoneEntryHint(phone));
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
		<div class="flex justify-start">
			<KioskBackButton href={homeUrl} />
		</div>
		<div class="flex min-h-0 flex-1 flex-col gap-3 kiosk-portrait:justify-start">
			<!-- sr-only is out of flow, so landscape layout is unchanged; portrait shows it as the page title. -->
			<header class="sr-only text-center kiosk-portrait:not-sr-only kiosk-portrait:mt-4">
				<h1 class="font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl">
					กรอกเบอร์โทรศัพท์
				</h1>
			</header>
			<KioskNumpadPanel
				bind:value={phone}
				maxLength={10}
				onsubmit={startLookup}
				label="ค้นหาด้วยเบอร์โทรศัพท์"
				class="kiosk-portrait:mt-4"
			>
				{#snippet header()}
					<header class="text-center">
						<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl">
							ใช้เบอร์ที่กรอกตอนลงทะเบียนล่วงหน้า
						</p>
					</header>
				{/snippet}

				{#snippet display()}
					<output
						class={[
							'flex min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-2xl font-bold text-slate-950 tabular-nums kiosk-portrait:min-h-20 kiosk-portrait:rounded-2xl kiosk-portrait:border-2',
							displayPhone
								? 'kiosk-portrait:text-4xl'
								: 'kiosk-portrait:text-2xl kiosk-portrait:font-semibold kiosk-portrait:text-slate-400'
						]}
						aria-label="เบอร์โทรศัพท์ที่กรอก"
						aria-live="polite"
					>
						{displayPhone || 'เบอร์โทรศัพท์'}
					</output>
				{/snippet}

				{#snippet actions()}
					<Button
						type="button"
						disabled={!isValid}
						onclick={startLookup}
						class="min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
					>
						<Search class="h-5 w-5" aria-hidden="true" />ค้นหา
					</Button>
				{/snippet}

				{#snippet footer()}
					<!-- Portrait only: says why the search button is disabled. Hidden (and unread) in landscape. -->
					<p
						class="hidden min-h-7 text-center text-lg font-semibold text-amber-900 kiosk-portrait:block"
						aria-live="polite"
					>
						{entryHint ?? ''}
					</p>
					<p
						class="kiosk-numpad-panel-note text-center text-sm leading-snug text-slate-600 kiosk-portrait:text-lg"
					>
						ไม่มีเบอร์? ใช้ QR หรือบัตรประชาชน หรือติดต่อเจ้าหน้าที่
					</p>
				{/snippet}
			</KioskNumpadPanel>
		</div>
	</div>
{/if}
