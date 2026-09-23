<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button/index.js';
	import { KioskCheckInWizard } from '$lib/features/kiosk';

	const homeUrl = $derived(`/kiosk${page.url.search}`);
	const errorMsg = $derived(
		page.url.searchParams.get('error_msg') || 'ตรวจสอบการเสียบบัตร แล้วลองอีกครั้ง'
	);
</script>

<svelte:head>
	<title>อ่านบัตรไม่สำเร็จ — SmartShelter Kiosk</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-labelledby="scanner-error-title">
	<KioskCheckInWizard currentStep={2} />

	<section class="rounded-2xl border border-red-200 bg-white p-5 shadow-2xs sm:p-7">
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
					class="text-xl font-extrabold tracking-tight text-[#0A2647] sm:text-2xl"
				>
					อ่านบัตรไม่สำเร็จ
				</h1>
				<p class="mt-1 text-base font-medium text-red-900" role="alert">{errorMsg}</p>
			</div>
		</header>

		<ol class="mt-5 grid gap-2 sm:grid-cols-3" aria-label="วิธีลองอีกครั้ง">
			<li
				class="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-[#F8FAFC] p-3 text-sm font-semibold text-slate-800 sm:text-base"
			>
				<ArrowUp class="h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />ถอดบัตร
			</li>
			<li
				class="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-[#F8FAFC] p-3 text-sm font-semibold text-slate-800 sm:text-base"
			>
				<RotateCcw class="h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />เช็ดชิป แล้วลองใหม่
			</li>
			<li
				class="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-[#F8FAFC] p-3 text-sm font-semibold text-slate-800 sm:text-base"
			>
				<UserCheck class="h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />เรียกเจ้าหน้าที่
			</li>
		</ol>
	</section>

	<div class="flex justify-center">
		<Button
			href={homeUrl}
			variant="ghost"
			class="min-h-12 gap-2 px-4 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647]"
		>
			<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
		</Button>
	</div>
</section>
