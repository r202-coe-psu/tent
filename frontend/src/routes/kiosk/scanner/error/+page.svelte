<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import { KioskBackButton, KioskCheckInWizard } from '$lib/features/kiosk';

	const steps = [
		{ title: 'ตรวจว่าเสียบถูกด้าน', hint: 'คว่ำบัตรลง เอาด้านบาร์โค้ดเข้า แล้วเสียบให้สุด' },
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

<section
	class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4"
	aria-labelledby="scanner-error-title"
>
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} />
	</div>

	<div class="flex flex-col gap-4 kiosk-portrait:gap-6">
		<section
			class="rounded-2xl border border-red-200 bg-white p-5 shadow-2xs sm:p-7 kiosk-compact:p-3"
		>
			<header class="flex items-center gap-3">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-800"
					aria-hidden="true"
				>
					<AlertOctagon class="h-7 w-7" />
				</div>
				<div>
					<h1
						id="scanner-error-title"
						class="text-xl font-extrabold tracking-tight text-[#0A2647] sm:text-2xl kiosk-portrait:text-4xl"
					>
						อ่านบัตรไม่สำเร็จ
					</h1>
					<p
						class="mt-1 text-base font-medium text-red-900 kiosk-compact:mt-0 kiosk-compact:text-sm"
						role="alert"
					>
						{errorMsg}
					</p>
				</div>
			</header>

			<ol
				class="mt-5 space-y-3 kiosk-portrait:mt-8 kiosk-portrait:space-y-4 kiosk-compact:mt-2 kiosk-compact:space-y-1.5"
				aria-label="วิธีลองอีกครั้ง"
			>
				{#each steps as step, i (step.title)}
					<li class="flex items-start gap-3 kiosk-portrait:gap-4">
						<span
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-base font-bold text-white kiosk-portrait:h-11 kiosk-portrait:w-11 kiosk-portrait:text-xl kiosk-compact:h-7 kiosk-compact:w-7"
							aria-hidden="true">{i + 1}</span
						>
						<div class="min-w-0 pt-0.5 kiosk-portrait:pt-1.5">
							<p class="text-base font-bold text-slate-900 kiosk-portrait:text-2xl">{step.title}</p>
							<p
								class="mt-0.5 text-sm text-slate-600 kiosk-portrait:text-xl kiosk-compact:mt-0 kiosk-compact:text-xs"
							>
								{step.hint}
							</p>
						</div>
					</li>
				{/each}
			</ol>

			<div
				class="mt-5 flex items-center gap-3 rounded-xl bg-red-50 p-3 text-red-900 kiosk-portrait:mt-8 kiosk-portrait:gap-4 kiosk-portrait:p-5 kiosk-compact:mt-2 kiosk-compact:p-2"
			>
				<UserCheck
					class="h-6 w-6 shrink-0 kiosk-portrait:h-9 kiosk-portrait:w-9"
					aria-hidden="true"
				/>
				<p class="text-base font-bold kiosk-portrait:text-2xl">
					ลองแล้วยังไม่ได้ผล? เรียกเจ้าหน้าที่ให้ช่วย
				</p>
			</div>
		</section>
	</div>
</section>
