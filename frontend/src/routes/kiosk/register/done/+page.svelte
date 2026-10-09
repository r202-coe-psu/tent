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
		KIOSK_NOTICE_PRIMARY_ACTION,
		KioskCheckInWizard,
		KioskNoticePanel,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession
	} from '$lib/features/kiosk';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
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
	<KioskNoticePanel
		tone="success"
		icon={CheckCircle2}
		title="ลงทะเบียนสำเร็จ"
		headingTag="h1"
		role="status"
	>
		<p>กรุณานำบัตรออกจากเครื่อง แล้วไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูลและรายงานตัว</p>
		{#snippet actions()}
			<Button type="button" onclick={returnHome} class={KIOSK_NOTICE_PRIMARY_ACTION}
				>กลับหน้าแรก</Button
			>
		{/snippet}
	</KioskNoticePanel>
</div>
