<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		getKioskDisplayContext,
		KioskCheckInWizard,
		isFaceCheckEnabled,
		loadKioskHardware,
		navigateToKioskHome,
		readKioskDisplayQuery,
		submitWalkInCard,
		walkInSession,
		type KioskHardware
	} from '$lib/features/kiosk';
	import type { SmartCardData } from '$lib/features/scanners';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	let ready = $state(false);
	/** scanner_client is reading the chip; pulling the card now loses the photo. */
	let cardReading = $state(false);
	let reading = $state(false);
	let error = $state('');
	// Unknown (null) counts as no face check: the scanner client answers in milliseconds, the chip read takes seconds.
	let hardware = $state<KioskHardware | null>(null);
	const busy = $derived(cardReading || reading);
	onMount(() => {
		if (!walkInSession.citizenId || !walkInSession.consented) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		void loadKioskHardware().then((loaded) => (hardware = loaded));
		const onCardReading = () => {
			cardReading = true;
			error = '';
		};
		const onCardRead = (event: Event) => void handleFullRead(event);
		const onCardReadError = () => {
			cardReading = false;
			reading = false;
			error = 'อ่านข้อมูลบัตรไม่สำเร็จ กรุณานำบัตรออกแล้วเสียบใหม่';
		};
		window.addEventListener('kiosk:smart-card-reading', onCardReading);
		window.addEventListener('kiosk:smart-card-full-read', onCardRead);
		window.addEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		ready = true;
		return () => {
			ready = false;
			window.removeEventListener('kiosk:smart-card-reading', onCardReading);
			window.removeEventListener('kiosk:smart-card-full-read', onCardRead);
			window.removeEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		};
	});
	function returnHome() {
		// The chip photo may be set aside on the scanner client for the face check.
		if (hardware && isFaceCheckEnabled(hardware.faceCheck, 'walk_in')) void cancelKioskFaceCheck();
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}
	async function handleFullRead(event: Event) {
		if (reading) return;
		const card = (event as CustomEvent<SmartCardData>).detail;
		cardReading = false;
		if (!card || typeof card.citizen_id !== 'string') return;
		if (
			hardware &&
			isFaceCheckEnabled(hardware.faceCheck, 'walk_in') &&
			card.citizen_id === walkInSession.citizenId
		) {
			// Hold the card in memory; the face page registers it once the check has ended.
			walkInSession.holdCard(card);
			await goto(
				resolve(
					`/kiosk/register/face${contextQuery}` as
						'/kiosk/register/face' | `/kiosk/register/face?${string}`
				)
			);
			return;
		}
		reading = true;
		error = '';
		const outcome = await submitWalkInCard(card, walkInSession);
		if (outcome.kind === 'registered') {
			walkInSession.clear();
			await goto(
				resolve(
					`/kiosk/register/done${contextQuery}` as
						'/kiosk/register/done' | `/kiosk/register/done?${string}`
				)
			);
		} else {
			if (outcome.kind === 'mismatch' || outcome.kind === 'error') error = outcome.message;
			reading = false;
		}
	}
</script>

<svelte:head><title>เสียบบัตรประชาชน — SmartShelter Kiosk</title></svelte:head>
<div
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3"
	data-kiosk-register-ready={ready ? 'true' : 'false'}
>
	<KioskCheckInWizard currentStep={3} step2Label="อ่านบัตร" />
	<!-- Busy: tighter padding so the status, the warning and "ยกเลิก" fit the 1024×600 panel. -->
	<section
		class={[
			'mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-sky-200 bg-white p-6 text-center shadow-2xs',
			busy ? 'kiosk-portrait:p-10' : 'sm:p-10'
		]}
	>
		{#if busy}
			<h1 class="text-2xl font-bold text-[#0A2647] kiosk-portrait:text-4xl">
				{cardReading ? 'กำลังอ่านข้อมูลบัตร' : 'กำลังบันทึกข้อมูล'}
			</h1>
			<div
				class="mt-4 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 text-base font-semibold text-slate-800 kiosk-portrait:mt-6 kiosk-portrait:min-h-16 kiosk-portrait:text-2xl"
				role="status"
				aria-live="polite"
				data-testid="kiosk-register-card-busy"
			>
				<span
					class="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647] motion-reduce:animate-none kiosk-portrait:size-7"
					aria-hidden="true"
				></span>
				กรุณารอสักครู่
			</div>
			{#if cardReading}
				<div
					class="mx-auto mt-4 flex max-w-xl items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-lg font-bold text-amber-950 kiosk-portrait:mt-6 kiosk-portrait:p-4"
				>
					<CircleAlert class="h-6 w-6 shrink-0" aria-hidden="true" />
					<p>อย่าดึงบัตรออก จนกว่าระบบจะอ่านเสร็จ</p>
				</div>
			{/if}
		{:else}
			<div
				class="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-900"
			>
				<CreditCard class="h-8 w-8" aria-hidden="true" />
			</div>
			<h1 class="mt-5 text-2xl font-bold text-[#0A2647] kiosk-portrait:text-4xl">
				เสียบบัตรประชาชน
			</h1>
			<p class="mt-2 text-base text-slate-700">
				เสียบบัตรของผู้ที่ต้องการลงทะเบียน (หากเสียบค้างอยู่แล้ว ไม่ต้องถอด)
				ระบบจะอ่านข้อมูลจากชิปโดยอัตโนมัติ
			</p>
		{/if}
		{#if error}<div
				class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-amber-950"
				role="alert"
			>
				<div class="flex gap-3">
					<CircleAlert class="h-5 w-5 shrink-0" aria-hidden="true" />
					<p>{error}</p>
				</div>
			</div>{/if}
		<div class="mt-6">
			<Button
				type="button"
				variant="outline"
				onclick={returnHome}
				disabled={busy}
				class="min-h-12 px-6">ยกเลิก</Button
			>
		</div>
	</section>
</div>
