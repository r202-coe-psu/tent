<script lang="ts">
	import { useRequisitionTickets } from '$lib/features/distribution';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import Truck from '@lucide/svelte/icons/truck';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Layers from '@lucide/svelte/icons/layers';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Verify remote query connectivity to requisition tickets (Slice 5.0 Foundation)
	const ticketsQuery = useRequisitionTickets(undefined, () => shelterCode);
	const isLoading = $derived(ticketsQuery.isLoading);
	const isError = $derived(ticketsQuery.isError);
	const ticketsCount = $derived(ticketsQuery.data?.length ?? 0);
</script>

<svelte:head>
	<title>จัดการการเบิกจ่ายพัสดุและอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-6 bg-slate-50/50 p-4 sm:p-6 lg:p-8">
	<!-- Page Header -->
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<div class="flex items-center gap-2.5">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200/80 bg-sky-50 text-sky-700"
				>
					<Truck class="h-5 w-5" />
				</div>
				<div>
					<h1 class="text-2xl font-bold tracking-tight text-slate-900">
						ระบบเบิกจ่ายพัสดุและอาหาร
					</h1>
					<p class="text-sm text-slate-500">
						ศูนย์ควบคุมตั๋วเบิกจ่ายพัสดุ อาหารปรุงสุก (Ready-Meal) และติดตามของยืม (CR-121)
					</p>
				</div>
			</div>
		</div>

		<!-- Shelter badge & Query status -->
		<div class="flex items-center gap-3">
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
	</div>

	<!-- Foundation Status Shell (Slice 5.0 Architecture) -->
	<div class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
		<div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
			<div>
				<h2 class="text-base font-semibold text-slate-900">
					สถาปัตยกรรมรากฐานและเลเยอร์คิวรี (Slice 5.0)
				</h2>
				<p class="text-xs text-slate-500">
					โครงข่ายการเรียกใช้ 19 เวิร์กโฟลว์ (CR-121 / CR-134), TanStack Query Cache,
					และระบบตรวจสอบสิทธิ์พร้อมใช้งาน
				</p>
			</div>

			<div class="text-right">
				{#if isLoading}
					<span class="inline-flex items-center gap-1.5 text-xs text-slate-500">
						<RefreshCw class="h-3.5 w-3.5 animate-spin text-slate-400" />
						กำลังเชื่อมต่อ Remote DB...
					</span>
				{:else if isError}
					<span class="text-xs font-medium text-red-600"> การเชื่อมต่อฐานข้อมูลล้มเหลว </span>
				{:else}
					<span class="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
						<ClipboardCheck class="h-3.5 w-3.5 text-emerald-600" />
						ตั๋วในระบบปัจจุบัน: <strong class="text-slate-900 tabular-nums">{ticketsCount}</strong> รายการ
					</span>
				{/if}
			</div>
		</div>

		<!-- Architecture Grid Metrics -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
				<div class="text-xs font-medium tracking-wider text-slate-500 uppercase">
					Query / Caller Layer
				</div>
				<div class="mt-1 text-lg font-bold text-slate-900">19 Workflows</div>
				<p class="mt-1 text-xs text-slate-600">
					ครอบคลุม Ticket Lifecycle, Handover, Loan Returns, และ CR-134 Bulk Pool
				</p>
			</div>

			<div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
				<div class="text-xs font-medium tracking-wider text-slate-500 uppercase">
					Session Actor Context
				</div>
				<div class="mt-1 text-lg font-bold text-slate-900">
					{authStore.user?.name ?? 'Anonymous'}
				</div>
				<p class="mt-1 text-xs text-slate-600">
					ระบุตัวตนผู้ปฏิบัติงานอัตโนมัติจากเซสชัน ปราศจากการกรอกอิสระ
				</p>
			</div>

			<div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
				<div class="text-xs font-medium tracking-wider text-slate-500 uppercase">
					Operation Replay Safety
				</div>
				<div class="mt-1 text-lg font-bold text-slate-900">Stable ULID</div>
				<p class="mt-1 text-xs text-slate-600">
					คงเอกลักษณ์การเรียกซ้ำในหน่วยความจำ ป้องกัน Double-Debit และ Replay Mismatch
				</p>
			</div>
		</div>

		<!-- Next Slices Roadmap Shell Notice -->
		<div
			class="mt-6 flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4 text-xs text-sky-900"
		>
			<PackageCheck class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
			<div>
				<span class="font-semibold">เตรียมความพร้อมสำหรับ Slice 5.1 & Slice 5.2:</span>
				หน้าจอนี้เป็น Navigation Shell สำหรับเลเยอร์รากฐานตามแผนงาน Phase 5 ใน Slice 5.1 ระบบจะเชื่อมต่อตารางค้นหา/คัดกรองตั๋ว
				(Ticket Management Table) และฟอร์มสร้างตั๋วเบิก (Create Ticket Dialog — Stops at PENDING_PICK)
				เข้ากับคิวรีเลเยอร์นี้อย่างสมบูรณ์
			</div>
		</div>
	</div>
</div>
