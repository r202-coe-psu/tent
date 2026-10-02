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
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskCheckInWizard,
		buildKioskPhotoPayload,
		navigateToKioskHome,
		readKioskDisplayQuery,
		registerKioskWalkIn,
		registerWalkInCardRead,
		walkInSession
	} from '$lib/features/kiosk';
	import type { SmartCardData } from '$lib/features/scanners';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	let ready = $state(false);
	let reading = $state(false);
	let error = $state('');
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	onMount(() => {
		if (!walkInSession.citizenId || !walkInSession.consented) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		const onCardRead = (event: Event) => void handleFullRead(event);
		const onCardReadError = () => {
			reading = false;
			error = 'อ่านข้อมูลบัตรไม่สำเร็จ กรุณานำบัตรออกแล้วเสียบใหม่';
		};
		window.addEventListener('kiosk:smart-card-full-read', onCardRead);
		window.addEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		ready = true;
		return () => {
			idleTimeout.stop();
			ready = false;
			window.removeEventListener('kiosk:smart-card-full-read', onCardRead);
			window.removeEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		};
	});
	function activity() {
		idleTimeout.recordActivity();
	}
	function returnHome() {
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}
	async function handleFullRead(event: Event) {
		if (reading) return;
		const card = (event as CustomEvent<SmartCardData>).detail;
		if (!card || typeof card.citizen_id !== 'string') return;
		reading = true;
		error = '';
		const outcome = await registerWalkInCardRead(
			card,
			walkInSession,
			async (fullCard, consentedAt) => {
				const photo = await buildKioskPhotoPayload(fullCard.photo_base64).catch(() => null);
				const cardWithoutPhoto = { ...fullCard, photo_base64: undefined };
				return registerKioskWalkIn(cardWithoutPhoto, photo, consentedAt);
			}
		);
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
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto w-full max-w-5xl space-y-4 py-3"
	data-kiosk-register-ready={ready ? 'true' : 'false'}
>
	<KioskCheckInWizard currentStep={3} step2Label="อ่านบัตร" />
	<section
		class="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-sky-200 bg-white p-6 text-center shadow-2xs sm:p-10"
	>
		<div
			class="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-900"
		>
			<CreditCard class="h-8 w-8" aria-hidden="true" />
		</div>
		<h1 class="mt-5 text-2xl font-bold text-[#0A2647] kiosk-portrait:text-4xl">เสียบบัตรประชาชน</h1>
		<p class="mt-2 text-base text-slate-700">
			เสียบบัตรของผู้ที่ต้องการลงทะเบียน (หากเสียบค้างอยู่แล้ว ไม่ต้องถอด)
			ระบบจะอ่านข้อมูลจากชิปโดยอัตโนมัติ
		</p>
		{#if reading}<p class="mt-5 text-base font-semibold text-sky-900" role="status">
				กำลังอ่านและบันทึกข้อมูล…
			</p>{/if}
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
			<Button type="button" variant="outline" onclick={returnHome} class="min-h-12 px-6"
				>ยกเลิก</Button
			>
		</div>
	</section>
</div>
