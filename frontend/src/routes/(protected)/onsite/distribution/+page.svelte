<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Truck from '@lucide/svelte/icons/truck';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Lock from '@lucide/svelte/icons/lock';
	import Layers from '@lucide/svelte/icons/layers';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
</script>

<svelte:head>
	<title>จุดแจกจ่ายพัสดุและอาหาร (Station 4) · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
	<!-- Back Navigation -->
	<div class="mb-6">
		<a
			href={resolve('/onsite')}
			class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900"
		>
			<ArrowLeft class="size-3.5" />
			<span>กลับหน้าระบบส่วนหน้า</span>
		</a>
	</div>

	<!-- Header -->
	<header class="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/80 bg-sky-50 text-sky-700 shadow-xs"
			>
				<Truck class="size-6" />
			</div>
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
					จุดแจกจ่ายพัสดุและอาหาร
				</h1>
				<p class="text-xs font-medium tracking-wider text-slate-500 uppercase sm:text-sm">
					Distribution Desk (Station 4)
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5">
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-xs"
			>
				<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
				ศูนย์: {shelterCode}
			</span>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 shadow-xs"
			>
				<Layers class="h-3.5 w-3.5 text-sky-600" />
				Slice 5.0 Foundation
			</span>
		</div>
	</header>

	<!-- Station Tabs Architecture Preview -->
	<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center opacity-75 shadow-xs"
		>
			<Truck class="mb-1.5 size-4 text-sky-600" />
			<span class="text-xs font-semibold text-slate-800">1. รับของถึงจุดแจก</span>
			<span class="text-[11px] text-slate-400">Receive Cargo</span>
		</div>

		<div
			class="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center opacity-75 shadow-xs"
		>
			<UtensilsCrossed class="mb-1.5 size-4 text-amber-600" />
			<span class="text-xs font-semibold text-slate-800">2. แจกอาหารปรุงสุก</span>
			<span class="text-[11px] text-slate-400">Food Handover</span>
		</div>

		<div
			class="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center opacity-75 shadow-xs"
		>
			<Package class="mb-1.5 size-4 text-indigo-600" />
			<span class="text-xs font-semibold text-slate-800">3. จ่ายของ & ให้ยืม</span>
			<span class="text-[11px] text-slate-400">Supplies & Loans</span>
		</div>

		<div
			class="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center opacity-75 shadow-xs"
		>
			<RotateCcw class="mb-1.5 size-4 text-emerald-600" />
			<span class="text-xs font-semibold text-slate-800">4. รับคืน & ด่านออก</span>
			<span class="text-[11px] text-slate-400">Return & Gate Clear</span>
		</div>

		<div
			class="col-span-2 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center opacity-75 shadow-xs sm:col-span-1"
		>
			<Lock class="mb-1.5 size-4 text-slate-600" />
			<span class="text-xs font-semibold text-slate-800">5. ปิดรอบ & คืนคลัง</span>
			<span class="text-[11px] text-slate-400">Shift Close</span>
		</div>
	</div>

	<!-- Main Station Container Shell -->
	<main class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8">
		<div class="flex flex-col items-center justify-center py-8 text-center sm:py-12">
			<div
				class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-200/80 bg-sky-50 text-sky-700 shadow-xs"
			>
				<Truck class="size-8" />
			</div>

			<h2 class="text-xl font-bold text-slate-900">
				โครงข่ายส่วนหน้าสำหรับจุดแจกจ่าย (Station 4 Shell)
			</h2>
			<p class="mt-2 max-w-xl text-sm text-slate-500">
				เลเยอร์คิวรีและตัวจัดการสิทธิ์ (RBAC Capability Helpers) ได้รับการติดตั้งเรียบร้อยแล้ว
				สำหรับรองรับการแจกจ่ายอาหาร การยืม-คืนสิ่งของบรรเทาทุกข์ และการกระทบยอดปิดรอบ
			</p>

			<div class="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-600">
				<span
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
				>
					ผู้ปฏิบัติงาน: <strong class="text-slate-900"
						>{authStore.user?.name ?? 'Anonymous'}</strong
					>
				</span>
				<span
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
				>
					สถาปัตยกรรม: <strong class="text-slate-900">Remote-First Online (Fail-Closed)</strong>
				</span>
				<span
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
				>
					สถานะ: <strong class="text-sky-700">พร้อมรับการต่อยอด Slice 5.4 & Slice 5.5</strong>
				</span>
			</div>
		</div>
	</main>
</div>
