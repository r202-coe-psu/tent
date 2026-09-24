<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button/index.js';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { KioskCheckInWizard } from '$lib/features/kiosk';

	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>กำลังอ่านบัตร — SmartShelter Kiosk</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1" aria-labelledby="reading-title">
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<Button
			href={backUrl}
			variant="ghost"
			aria-label="กลับหน้าเริ่มต้น"
			class="min-h-11 gap-2 px-3 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647]"
		>
			<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
		</Button>
	</div>

	<section
		class="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xs sm:p-10"
	>
		<div
			class="flex h-16 w-16 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
			aria-hidden="true"
		>
			<CreditCard class="h-8 w-8" />
		</div>
		<h1
			id="reading-title"
			class="mt-4 text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
		>
			กำลังอ่านบัตร
		</h1>
		<div
			class="mt-4 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 text-base font-semibold text-slate-800"
			role="status"
			aria-live="polite"
		>
			<span
				class="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647] motion-reduce:animate-none"
				aria-hidden="true"
			></span>
			กรุณารอสักครู่
		</div>
		<p class="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600">
			<ShieldCheck
				class="h-4 w-4 shrink-0 text-[#0A2647]"
				aria-hidden="true"
			/>ใช้เลขบัตรค้นหาการลงทะเบียนเท่านั้น
		</p>
	</section>
</main>
