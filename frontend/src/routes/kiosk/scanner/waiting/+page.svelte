<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';

	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>กรุณาเสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-6xl flex-1 flex-col gap-5 py-2 sm:gap-6 sm:py-3 lg:max-w-7xl lg:gap-8 lg:py-4"
>
	<section class="mx-auto w-full max-w-4xl" aria-labelledby="waiting-title">
		<div class="relative flex min-h-10 items-center justify-center">
			<Button
				href={backUrl}
				variant="ghost"
				aria-label="กลับไปเลือกวิธียืนยันตัวตน"
				class="absolute top-1/2 left-0 min-h-11 -translate-y-1/2 gap-2 px-1 text-sm font-bold text-[#0A2647] hover:bg-[#F0F4F8] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none sm:px-2 sm:text-base"
			>
				<ArrowLeft class="h-5 w-5" aria-hidden="true" />
				<span class="sm:hidden">กลับ</span>
				<span class="hidden sm:inline">กลับไปเลือกวิธี</span>
			</Button>
			<div
				class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-[#CBD5E1] bg-[#F0F4F8] px-3 py-2 text-xs font-bold text-[#0A2647] sm:px-4 sm:text-sm"
			>
				<CreditCard class="h-5 w-5" aria-hidden="true" />
				<span>1 / 3</span>
			</div>
		</div>

		<div class="flex flex-col items-center text-center">
			<h1
				id="waiting-title"
				class="mt-3 text-2xl leading-tight font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
			>
				เสียบบัตรประชาชน
			</h1>
			<p class="mt-1 hidden text-sm leading-relaxed text-slate-700 sm:block sm:text-base">
				ใส่บัตรประชาชนเข้าที่เครื่องอ่านตามภาพ ระบบจะเริ่มอ่านข้อมูลโดยอัตโนมัติ
			</p>
		</div>

		<div class="relative mt-4 sm:mt-6">
			<div
				class="absolute top-5 right-[16%] left-[16%] h-px bg-[#CBD5E1] sm:top-6"
				aria-hidden="true"
			></div>
			<ol
				class="relative grid grid-cols-3 gap-2 sm:gap-4"
				aria-label="ขั้นตอนการลงทะเบียนด้วยบัตรประชาชน"
			>
				<li class="relative z-10 flex flex-col items-center gap-2 text-center">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A2647] text-sm font-bold text-white shadow-xs ring-4 ring-[#F0F4F8] sm:h-12 sm:w-12 sm:text-base"
						aria-current="step"
					>
						1
					</div>
					<span class="text-xs font-bold text-[#0A2647] sm:text-base">เสียบบัตร</span>
				</li>
				<li class="relative z-10 flex flex-col items-center gap-2 text-center">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full border border-[#CBD5E1] bg-white text-sm font-bold text-slate-500 sm:h-12 sm:w-12 sm:text-base"
					>
						2
					</div>
					<span class="text-xs font-semibold text-slate-600 sm:text-base">รอระบบอ่าน</span>
				</li>
				<li class="relative z-10 flex flex-col items-center gap-2 text-center">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full border border-[#CBD5E1] bg-white text-sm font-bold text-slate-500 sm:h-12 sm:w-12 sm:text-base"
					>
						3
					</div>
					<span class="text-xs font-semibold text-slate-600 sm:text-base">ถอดบัตรออก</span>
				</li>
			</ol>
		</div>
	</section>

	<main
		class="grid w-full flex-1 items-start gap-3 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8"
	>
		<section
			class="flex flex-col items-center rounded-2xl border border-[#CBD5E1] bg-white p-3 shadow-2xs sm:p-6"
			aria-labelledby="card-illustration-title"
		>
			<div class="flex w-full max-w-md items-center justify-between gap-3">
				<div>
					<p class="text-sm font-bold tracking-wide text-[#0A2647]">วางบัตรให้ถูกด้าน</p>
					<h2
						id="card-illustration-title"
						class="mt-1 text-lg font-bold text-slate-900 sm:text-2xl"
					>
						หงายชิปสีทองขึ้น
					</h2>
				</div>
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
					aria-hidden="true"
				>
					<CreditCard class="h-6 w-6" />
				</div>
			</div>

			<div class="mt-4 w-full max-w-[22rem] rounded-2xl bg-[#0A2647] sm:mt-5 sm:max-w-md">
				<div
					class="relative z-10 aspect-[1.586/1] w-full overflow-hidden rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 shadow-xs sm:p-6"
					aria-label="ภาพจำลองบัตรประชาชน โดยให้ชิปสีทองอยู่ด้านบน"
				>
					<div class="flex items-center justify-between gap-3">
						<div
							class="flex h-3.5 w-16 overflow-hidden rounded border border-slate-200"
							aria-hidden="true"
						>
							<div class="w-1/5 bg-red-600"></div>
							<div class="w-1/5 bg-white"></div>
							<div class="w-1/5 bg-[#0A2647]"></div>
							<div class="w-1/5 bg-white"></div>
							<div class="w-1/5 bg-red-600"></div>
						</div>
						<div class="flex items-center gap-1.5 text-xs font-bold text-slate-600 sm:text-sm">
							<CreditCard class="h-4 w-4 text-[#0A2647]" aria-hidden="true" />
							<span>THAI ID</span>
						</div>
					</div>

					<div
						class="absolute inset-x-4 top-1/2 flex -translate-y-1/2 items-center gap-4 sm:inset-x-6 sm:gap-6"
					>
						<div
							class="flex h-14 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-300 shadow-xs sm:h-16 sm:w-24"
							aria-label="ชิปสีทอง"
						>
							<div class="grid grid-cols-2 gap-1.5 opacity-80" aria-hidden="true">
								<div class="h-3 w-5 rounded-sm border border-amber-700/70 bg-amber-500/50"></div>
								<div class="h-3 w-5 rounded-sm border border-amber-700/70 bg-amber-500/50"></div>
								<div class="h-3 w-5 rounded-sm border border-amber-700/70 bg-amber-500/50"></div>
								<div class="h-3 w-5 rounded-sm border border-amber-700/70 bg-amber-500/50"></div>
							</div>
						</div>
						<div class="flex min-w-0 flex-1 items-center gap-3">
							<div
								class="hidden h-16 w-12 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] bg-[#F0F4F8] sm:flex"
							>
								<UserRound class="h-7 w-7 text-[#0A2647]" aria-hidden="true" />
							</div>
							<div class="min-w-0 flex-1 space-y-2">
								<div class="h-3.5 w-4/5 rounded bg-slate-300"></div>
								<div class="h-2.5 w-full rounded bg-slate-200"></div>
								<div class="h-2.5 w-3/5 rounded bg-slate-200"></div>
							</div>
						</div>
					</div>

					<div
						class="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-2.5 text-xs font-semibold text-slate-500 sm:inset-x-6 sm:bottom-6"
					>
						<span>เลขประจำตัวประชาชน 13 หลัก</span>
						<span class="text-[#0A2647]">SMART CARD</span>
					</div>
				</div>

				<div
					class="kiosk-card-slot -mt-1 flex min-h-12 items-center justify-center gap-3 rounded-b-2xl border border-[#0A2647] bg-[#0A2647] px-3 text-center text-sm font-bold text-white sm:min-h-14 sm:px-4 sm:text-base"
				>
					<div
						class="kiosk-card-arrow flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15"
					>
						<ArrowDown class="h-5 w-5" aria-hidden="true" />
					</div>
					<span>ช่องเสียบบัตร Smart Card Reader</span>
				</div>
			</div>

			<p class="mt-3 text-center text-xs font-semibold text-slate-600 sm:mt-4 sm:text-base">
				เสียบการ์ดเข้าหาตัวเครื่องจนสุด แล้วรอระบบอ่านข้อมูล
			</p>
		</section>

		<section
			class="hidden rounded-2xl border border-[#CBD5E1] bg-white p-5 shadow-2xs sm:p-6 lg:block"
			aria-labelledby="instruction-title"
		>
			<div class="flex items-start gap-3">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
					aria-hidden="true"
				>
					<ScanLine class="h-6 w-6" />
				</div>
				<div>
					<p class="text-sm font-bold tracking-wide text-[#0A2647]">ขั้นตอนนี้ใช้เวลาไม่นาน</p>
					<h2 id="instruction-title" class="mt-1 text-2xl font-bold text-slate-900">
						ทำตาม 3 ขั้นตอน
					</h2>
				</div>
			</div>

			<ol class="mt-6 space-y-3">
				<li class="flex items-center gap-3 rounded-xl border border-[#CBD5E1] bg-[#F0F4F8] p-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647] text-sm font-bold text-white"
						>1</span
					>
					<span class="text-base font-semibold text-slate-800">หงายชิปสีทองขึ้น</span>
				</li>
				<li class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F0F4F8] text-sm font-bold text-[#0A2647]"
						>2</span
					>
					<span class="text-base font-semibold text-slate-800">เสียบบัตรเข้าช่องให้สุด</span>
				</li>
				<li class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F0F4F8] text-sm font-bold text-[#0A2647]"
						>3</span
					>
					<span class="text-base font-semibold text-slate-800">รอระบบอ่านก่อนถอดบัตร</span>
				</li>
			</ol>

			<div
				class="mt-6 flex items-start gap-3 rounded-xl border border-[#CBD5E1] bg-[#F0F4F8] p-4"
				aria-live="polite"
			>
				<span class="relative mt-1 flex h-3 w-3 shrink-0" aria-hidden="true">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0A2647] opacity-25"
					></span>
					<span class="relative inline-flex h-3 w-3 rounded-full bg-[#0A2647]"></span>
				</span>
				<div>
					<p class="text-base font-bold text-[#0A2647]">กำลังรอการเสียบบัตร</p>
					<p class="mt-1 text-sm leading-relaxed text-slate-600">
						เมื่อเสียบบัตรแล้ว ระบบจะเริ่มอ่านข้อมูลให้อัตโนมัติ
					</p>
				</div>
			</div>

			<div class="mt-5 flex items-start gap-2 text-sm leading-relaxed text-slate-500">
				<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-[#0A2647]" aria-hidden="true" />
				<span>อย่าถอดบัตรจนกว่าระบบจะแจ้งให้ถอด</span>
			</div>
		</section>

		<section
			class="flex items-start gap-3 rounded-xl border border-[#CBD5E1] bg-[#F0F4F8] p-3 lg:hidden"
			aria-live="polite"
		>
			<span class="relative mt-1 flex h-3 w-3 shrink-0" aria-hidden="true">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0A2647] opacity-25"
				></span>
				<span class="relative inline-flex h-3 w-3 rounded-full bg-[#0A2647]"></span>
			</span>
			<div>
				<p class="text-sm font-bold text-[#0A2647]">กำลังรอการเสียบบัตร</p>
				<p class="mt-0.5 text-xs leading-relaxed text-slate-600">
					เสียบบัตรตามภาพ แล้วรอระบบแจ้งให้ถอด
				</p>
			</div>
		</section>
	</main>
</div>

<style>
	.kiosk-card-slot {
		animation: kiosk-slot-pulse 3.2s ease-in-out infinite;
	}

	.kiosk-card-arrow {
		animation: kiosk-arrow-nudge 1.8s ease-in-out infinite;
	}

	@keyframes kiosk-slot-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgb(10 38 71 / 0%);
		}
		50% {
			box-shadow: 0 0 0 5px rgb(10 38 71 / 10%);
		}
	}

	@keyframes kiosk-arrow-nudge {
		0%,
		100% {
			transform: translateY(-2px);
		}
		50% {
			transform: translateY(3px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.kiosk-card-slot,
		.kiosk-card-arrow {
			animation: none;
		}
	}
</style>
