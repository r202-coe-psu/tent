<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskCheckInWizard,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession
	} from '$lib/features/kiosk';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	// Set by the face step when it ran visibly and did not confirm the person (see register/face).
	const staffRecheck = $derived(page.url.searchParams.get('face') === 'staff');
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	onMount(() => {
		walkInSession.clear();
		idleTimeout.start();
		return () => idleTimeout.stop();
	});
	function activity() {
		idleTimeout.recordActivity();
	}
	function returnHome() {
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}
</script>

<svelte:head><title>ลงทะเบียนสำเร็จ — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3">
	<KioskCheckInWizard currentStep={5} step2Label="ลงทะเบียน" />
	<section
		class="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-2xs sm:p-10"
	>
		<div
			class="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-900"
		>
			<CheckCircle2 class="h-9 w-9" aria-hidden="true" />
		</div>
		<h1 class="mt-5 text-2xl font-bold text-emerald-950 kiosk-portrait:text-4xl">
			ลงทะเบียนสำเร็จ
		</h1>
		<p class="mt-2 text-lg text-slate-700">
			กรุณานำบัตรออกจากเครื่อง แล้วไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูลและรายงานตัว
		</p>
		{#if staffRecheck}
			<p class="mt-2 text-lg font-semibold text-slate-900" data-testid="kiosk-staff-recheck">
				เจ้าหน้าที่จะตรวจสอบตัวตนของท่านอีกครั้ง
			</p>
		{/if}
		<div class="mt-7">
			<Button
				type="button"
				onclick={returnHome}
				class="min-h-12 bg-[#0A2647] px-8 text-base font-bold text-white hover:bg-[#051930]"
				>กลับหน้าแรก</Button
			>
		</div>
	</section>
</div>
