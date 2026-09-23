<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { KioskCheckInWizard } from '$lib/features/kiosk';

	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>เสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-labelledby="waiting-title">
	<KioskCheckInWizard currentStep={2} />

	<header class="text-center">
		<h1
			id="waiting-title"
			class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
		>
			เสียบบัตรประชาชน
		</h1>
		<p class="mt-1 text-base font-semibold text-slate-700">หงายชิปขึ้น</p>
	</header>

	<main class="mx-auto flex w-full max-w-md flex-col items-center">
		<div
			class="w-full overflow-hidden rounded-2xl border-2 border-[#0A2647] bg-[#0A2647] shadow-2xs"
		>
			<div class="bg-white p-4 sm:p-6" aria-label="ตัวอย่างบัตรประชาชน หงายชิปขึ้น">
				<div class="flex items-center justify-between">
					<div
						class="flex h-3 w-14 overflow-hidden rounded border border-slate-200"
						aria-hidden="true"
					>
						<div class="w-1/5 bg-red-600"></div>
						<div class="w-1/5 bg-white"></div>
						<div class="w-1/5 bg-[#0A2647]"></div>
						<div class="w-1/5 bg-white"></div>
						<div class="w-1/5 bg-red-600"></div>
					</div>
					<CreditCard class="h-5 w-5 text-[#0A2647]" aria-hidden="true" />
				</div>
				<div class="flex min-h-28 items-center gap-4 sm:min-h-36">
					<div
						class="flex h-14 w-[4.5rem] shrink-0 items-center justify-center rounded-lg border-2 border-amber-400 bg-amber-300"
						aria-label="ชิปสีทอง"
					>
						<div class="grid grid-cols-2 gap-1" aria-hidden="true">
							{#each [1, 2, 3, 4] as cell (cell)}
								<span class="h-3 w-5 rounded-sm border border-amber-700/70 bg-amber-500/50"></span>
							{/each}
						</div>
					</div>
					<div class="flex-1 space-y-2" aria-hidden="true">
						<div class="h-3 w-4/5 rounded bg-slate-300"></div>
						<div class="h-2.5 w-full rounded bg-slate-200"></div>
						<div class="h-2.5 w-3/5 rounded bg-slate-200"></div>
					</div>
				</div>
				<div class="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-500">
					SMART CARD
				</div>
			</div>

			<div
				class="flex min-h-16 w-full items-center justify-center gap-3 px-4 py-3 text-base font-bold text-white"
			>
				<ArrowDown
					class="h-5 w-5 animate-bounce motion-reduce:animate-none"
					aria-hidden="true"
				/>เสียบบัตรจนสุด
			</div>
		</div>

		<div
			class="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-700"
			role="status"
			aria-live="polite"
		>
			<span
				class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647] motion-reduce:animate-none"
				aria-hidden="true"
			></span>
			รออ่านบัตร · อย่าถอดบัตร
		</div>
	</main>

	<div class="flex justify-center">
		<Button
			href={backUrl}
			variant="ghost"
			aria-label="กลับหน้าเริ่มต้น"
			class="min-h-12 gap-2 px-4 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647]"
		>
			<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
		</Button>
	</div>
</section>
