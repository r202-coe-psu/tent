<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import {
		KioskBackButton,
		KioskCheckInWizard,
		KioskInlineAlert,
		KioskNoticePanel
	} from '$lib/features/kiosk';

	const steps = [
		{ title: 'ตรวจว่าเสียบถูกด้าน', hint: 'หงายบัตรขึ้น เอาด้านบาร์โค้ดเข้า แล้วเสียบให้สุด' },
		{ title: 'ถอดบัตรออก เช็ดชิปให้สะอาด', hint: 'ชิปสีทองต้องไม่เปื้อนหรือมีรอย' },
		{ title: 'เสียบบัตรใหม่อีกครั้ง', hint: 'รอจนเครื่องเริ่มอ่านบัตร' }
	];
	const homeUrl = $derived(`/kiosk${page.url.search}`);
	const errorMsg = $derived(
		page.url.searchParams.get('error_msg') || 'ตรวจสอบการเสียบบัตร แล้วลองอีกครั้ง'
	);
</script>

<svelte:head>
	<title>อ่านบัตรไม่สำเร็จ — SmartShelter Kiosk</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} />
	</div>

	<KioskNoticePanel tone="critical" icon={AlertOctagon} headingTag="h1" title="อ่านบัตรไม่สำเร็จ">
		<p class="font-semibold text-red-900" role="alert">{errorMsg}</p>
		<ol
			class="mx-auto space-y-3 pt-2 text-left kiosk-portrait:space-y-4 kiosk-portrait:pt-4 kiosk-compact:space-y-1.5 kiosk-compact:pt-0"
			aria-label="วิธีลองอีกครั้ง"
		>
			{#each steps as step, i (step.title)}
				<li class="flex items-start gap-3 kiosk-portrait:gap-4">
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-lg font-bold text-white tabular-nums kiosk-portrait:size-12 kiosk-portrait:text-2xl kiosk-compact:size-7 kiosk-compact:text-base"
						aria-hidden="true">{i + 1}</span
					>
					<div class="min-w-0 pt-0.5 kiosk-portrait:pt-1.5">
						<p class="font-bold text-slate-900">{step.title}</p>
						<p class="mt-0.5 text-base text-slate-600 kiosk-portrait:text-xl kiosk-compact:text-sm">
							{step.hint}
						</p>
					</div>
				</li>
			{/each}
		</ol>
		<KioskInlineAlert tone="warning" icon={UserCheck}
			>ลองแล้วยังไม่ได้ผล? เรียกเจ้าหน้าที่ให้ช่วย</KioskInlineAlert
		>
	</KioskNoticePanel>
</section>
