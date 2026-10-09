<script lang="ts">
	import { page } from '$app/state';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import {
		KioskBackButton,
		KioskBusyStatus,
		KioskCheckInWizard,
		KioskNoticePanel
	} from '$lib/features/kiosk';

	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>กำลังอ่านบัตร — SmartShelter Kiosk</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-1">
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={backUrl} />
	</div>

	<KioskNoticePanel tone="info" icon={CreditCard} headingTag="h1" title="กำลังอ่านบัตร">
		<KioskBusyStatus>กรุณารอสักครู่</KioskBusyStatus>
		<p
			class="flex items-center justify-center gap-2 text-base font-medium text-slate-600 kiosk-portrait:text-xl"
		>
			<ShieldCheck
				class="size-5 shrink-0 text-[#0A2647] kiosk-portrait:size-7"
				aria-hidden="true"
			/>ใช้เลขบัตรค้นหาการลงทะเบียนเท่านั้น
		</p>
	</KioskNoticePanel>
</main>
