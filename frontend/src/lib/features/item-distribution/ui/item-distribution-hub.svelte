<script lang="ts">
	import { setDistributionStore } from '../application/item-distribution-store.svelte';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import CreateRequisitionDialog from './create-requisition-dialog.svelte';
	import DistributeItemDialog from './distribute-item-dialog.svelte';
	import ReturnItemDialog from './return-item-dialog.svelte';
	import TicketDetailDialog from './ticket-detail-dialog.svelte';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import FileText from '@lucide/svelte/icons/file-text';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Send from '@lucide/svelte/icons/send';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Eye from '@lucide/svelte/icons/eye';
	import Expand from '@lucide/svelte/icons/expand';
	import { resolve } from '$app/paths';

	const store = setDistributionStore();
	const sheltersQuery = useShelters();

	const selectedShelterCode = $derived(shelterStore.selectedShelterCode ?? 'all');
	const currentShelterName = $derived.by(() => {
		if (!selectedShelterCode || selectedShelterCode === 'all') {
			return 'ภาพรวมทุกศูนย์พักพิง';
		}
		const match = sheltersQuery.data?.find((s) => s.code === selectedShelterCode);
		return match ? match.name : selectedShelterCode;
	});

	function handleShelterChange(val: string | undefined) {
		if (!val || val === 'all') {
			shelterStore.selectedShelterCode = undefined;
		} else {
			shelterStore.selectedShelterCode = val;
		}
	}

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(() => {});
		} else {
			document.exitFullscreen().catch(() => {});
		}
	}

	const STATUS_FILTER_LABELS: Record<string, string> = {
		all: 'สถานะ: ทั้งหมด (All Statuses)',
		pending_approval: '⏱️ รอจัดส่ง/รออนุมัติ',
		distributing: '🚚 กำลังแจกจ่าย',
		completed: '✅ เสร็จสิ้น',
		returned: '🔄 มีรายการคืน'
	};

	function getStatusBadge(status: string) {
		switch (status) {
			case 'pending_approval':
				return {
					label: '⏱️ รอจัดส่ง/รออนุมัติ',
					class:
						'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200'
				};
			case 'distributing':
				return {
					label: '🚚 กำลังแจกจ่าย',
					class: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200'
				};
			case 'completed':
				return {
					label: '✅ เสร็จสิ้น',
					class:
						'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200'
				};
			case 'partially_returned':
				return {
					label: '🔄 มีรายการคืน',
					class:
						'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200'
				};
			case 'cancelled':
				return {
					label: '❌ ยกเลิก',
					class: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200'
				};
			default:
				return { label: status, class: 'bg-slate-100 text-slate-800' };
		}
	}
</script>

<div
	class="min-h-screen bg-slate-50/50 pb-16 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100"
>
	<!-- Main Container -->
	<div class="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
		<!-- Sub-Header Card / Action Section -->
		<div
			class="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
		>
			<div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
				<!-- Title & Overview Link -->
				<div class="flex flex-wrap items-center gap-3">
					<Button
						variant="secondary"
						size="sm"
						href={resolve('/onsite')}
						class="gap-1.5 text-xs font-semibold"
					>
						<ArrowLeft class="size-3.5" />
						<span>กลับหน้ารวม</span>
					</Button>

					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-400"
						>
							<Package class="size-5" />
						</div>
						<h1
							class="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100"
						>
							<span>ระบบแจกจ่ายสิ่งของช่วยเหลือ</span>
							<span class="text-sm font-medium text-slate-400 dark:text-slate-500"
								>(Item Distribution)</span
							>
						</h1>
					</div>

					<!-- Shelter Select Dropdown -->
					<Select.Root
						type="single"
						value={selectedShelterCode}
						onValueChange={handleShelterChange}
					>
						<Select.Trigger
							class="h-8 gap-1.5 rounded-full border border-blue-200/80 bg-blue-50/80 px-3 text-xs font-bold text-blue-900 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
						>
							<Building2 class="size-3.5 text-blue-600 dark:text-blue-400" />
							<span class="max-w-[200px] truncate">{currentShelterName}</span>
						</Select.Trigger>
						<Select.Content align="start" class="w-[280px]">
							<Select.Group>
								<Select.Label class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
									เลือกศูนย์พักพิง (Shelter)
								</Select.Label>
								<Select.Item value="all" label="ภาพรวมทุกศูนย์พักพิง">
									🌐 ภาพรวมทุกศูนย์พักพิง (All Shelters)
								</Select.Item>
								{#each sheltersQuery.data ?? [] as shelter (shelter.code)}
									<Select.Item value={shelter.code} label={shelter.name}>
										🏢 {shelter.name}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Right Action Buttons & Stock Counter Pill -->
				<div class="flex items-center gap-3 self-end md:self-center">
					<Badge
						variant="outline"
						class="gap-2 rounded-full border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
					>
						<span class="size-2 animate-ping rounded-full bg-emerald-500"></span>
						<span>สิ่งของพร้อมแจก:</span>
						<span class="font-mono text-sm text-emerald-800 dark:text-emerald-200"
							>{store.readyStockTotalTypesCount}</span
						>
						<span>รายการ</span>
					</Badge>

					<Button onclick={() => store.openCreateModal()} class="gap-2 font-bold">
						<Plus class="size-4 stroke-[3]" />
						<span>ขอเบิกพัสดุใหม่</span>
					</Button>

					<Button
						variant="outline"
						size="icon"
						class="border"
						onclick={toggleFullscreen}
						aria-label="ขยายเต็มจอ"
					>
						<Expand class="size-4" />
					</Button>
				</div>
			</div>
		</div>

		<!-- Main Tabs Bar -->
		<div class="mb-6 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
			<!-- Tab 1: สิ่งของพร้อมแจก -->
			<button
				type="button"
				onclick={() => (store.activeTab = 'stock')}
				class="inline-flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition-all {store.activeTab ===
				'stock'
					? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
					: 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}"
			>
				<Package class="size-4" />
				<span>สิ่งของพร้อมแจก</span>
				<span
					class="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
				>
					{store.readyStockTotalTypesCount}
				</span>
			</button>

			<!-- Tab 2: ประวัติ & คำขอเบิก -->
			<button
				type="button"
				onclick={() => (store.activeTab = 'requisitions')}
				class="inline-flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition-all {store.activeTab ===
				'requisitions'
					? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
					: 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}"
			>
				<FileText class="size-4" />
				<span>ประวัติ & คำขอเบิก</span>
				<span
					class="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300"
				>
					{store.requisitions.length}
				</span>
			</button>
		</div>

		<!-- TAB 2 CONTENT: ประวัติ & คำขอเบิก -->
		{#if store.activeTab === 'requisitions'}
			<div
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
			>
				<!-- Section Header -->
				<div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
					<div>
						<h2
							class="flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-slate-100"
						>
							<FileText class="size-5 text-blue-600" />
							<span>ประวัติการเบิกและส่งคืนพัสดุ</span>
						</h2>
						<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
							ตรวจสอบประวัติคำขอเบิก ล็อตแจกจ่ายหน้างาน และใบรับคืนพัสดุเข้าคลังหลัก
						</p>
					</div>

					<div class="flex items-center gap-1.5 text-xs text-slate-500">
						<span class="font-semibold">สมการสมดุล:</span>
						<span class="rounded-md bg-slate-100 px-2.5 py-1 font-mono dark:bg-slate-800">
							ยอดเบิก = แจกจ่าย + ชำรุด/สูญหาย + ยอดคืน
						</span>
					</div>
				</div>

				<!-- Status Filter Chips -->
				<div class="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant={store.statusFilter === 'all' ? 'default' : 'secondary'}
						class="gap-1.5 rounded-xl {store.statusFilter === 'all'
							? 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900'
							: ''}"
						onclick={() => (store.statusFilter = 'all')}
					>
						<span>ทั้งหมด</span>
						<span class="rounded-full bg-black/10 px-1.5 py-0.5 font-mono dark:bg-white/10"
							>{store.requisitions.length}</span
						>
					</Button>
					<Button
						size="sm"
						variant={store.statusFilter === 'active' ? 'default' : 'secondary'}
						class="gap-1.5 rounded-xl {store.statusFilter === 'active'
							? 'bg-blue-600 hover:bg-blue-500'
							: ''}"
						onclick={() => (store.statusFilter = 'active')}
					>
						<span>⚡ รายการ Active (กำลังดำเนินงาน)</span>
						<span class="rounded-full bg-black/10 px-1.5 py-0.5 font-mono dark:bg-white/10"
							>{store.activeRequisitionsCount}</span
						>
					</Button>
					<Button
						size="sm"
						variant={store.statusFilter === 'pending_approval' ? 'default' : 'secondary'}
						class="gap-1.5 rounded-xl {store.statusFilter === 'pending_approval'
							? 'bg-amber-500 hover:bg-amber-400'
							: ''}"
						onclick={() => (store.statusFilter = 'pending_approval')}
					>
						<span>🕐 รออนุมัติ / รอตรวจรับ</span>
						<span class="rounded-full bg-black/10 px-1.5 py-0.5 font-mono dark:bg-white/10"
							>{store.pendingApprovalCount}</span
						>
					</Button>
					<Button
						size="sm"
						variant={store.statusFilter === 'completed' ? 'default' : 'secondary'}
						class="gap-1.5 rounded-xl {store.statusFilter === 'completed'
							? 'bg-emerald-600 hover:bg-emerald-500'
							: ''}"
						onclick={() => (store.statusFilter = 'completed')}
					>
						<span>✓ เสร็จสมบูรณ์ / คืนเข้าคลังแล้ว</span>
						<span class="rounded-full bg-black/10 px-1.5 py-0.5 font-mono dark:bg-white/10"
							>{store.completedRequisitionsCount}</span
						>
					</Button>
				</div>

				<!-- Toolbar & Filters -->
				<div class="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 md:grid-cols-4">
					<!-- Search Input -->
					<div class="relative sm:col-span-2">
						<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
						<Input
							type="text"
							bind:value={store.searchQuery}
							placeholder="ค้นหารหัส Ticket หรือ ชื่อสินค้า..."
							class="pl-9 text-xs"
						/>
					</div>

					<!-- Status Filter Select -->
					<Select.Root type="single" bind:value={store.statusFilter}>
						<Select.Trigger class="w-full text-xs">
							{STATUS_FILTER_LABELS[store.statusFilter] ?? store.statusFilter}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" label="สถานะ: ทั้งหมด (All Statuses)"
								>สถานะ: ทั้งหมด (All Statuses)</Select.Item
							>
							<Select.Item value="pending_approval" label="⏱️ รอจัดส่ง/รออนุมัติ"
								>⏱️ รอจัดส่ง/รออนุมัติ</Select.Item
							>
							<Select.Item value="distributing" label="🚚 กำลังแจกจ่าย">🚚 กำลังแจกจ่าย</Select.Item
							>
							<Select.Item value="completed" label="✅ เสร็จสิ้น">✅ เสร็จสิ้น</Select.Item>
							<Select.Item value="returned" label="🔄 มีรายการคืน">🔄 มีรายการคืน</Select.Item>
						</Select.Content>
					</Select.Root>

					<!-- Date Range Filter Select -->
					<Select.Root type="single" bind:value={store.dateRangeFilter}>
						<Select.Trigger class="w-full text-xs">ช่วงเวลา: ทุกช่วงเวลา</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" label="ช่วงเวลา: ทุกช่วงเวลา"
								>ช่วงเวลา: ทุกช่วงเวลา</Select.Item
							>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Counter Summary Row -->
				<div
					class="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800"
				>
					<span class="font-medium">รายการคำขอเบิกพัสดุในระบบ</span>
					<span
						class="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
					>
						ทั้งหมด {store.filteredRequisitions.length} รายการ
					</span>
				</div>

				<!-- Data Table -->
				<div class="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
					<table class="w-full text-left text-xs">
						<thead
							class="border-b border-slate-200 bg-slate-50 font-bold tracking-wider text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-400"
						>
							<tr>
								<th class="p-3.5">รหัส TICKET</th>
								<th class="min-w-[220px] p-3.5">รายการสินค้า</th>
								<th class="p-3.5 text-center">ยอดเบิกทั้งหมด</th>
								<th class="p-3.5 text-center">แจกจ่ายสำเร็จแล้ว</th>
								<th class="p-3.5 text-center">ชำรุด/สูญหาย</th>
								<th class="p-3.5 text-center">ยอดคืนสุทธิ</th>
								<th class="p-3.5 text-center">สถานะ</th>
								<th class="p-3.5 text-center">วันที่</th>
								<th class="p-3.5 text-center">รายละเอียด</th>
							</tr>
						</thead>

						<tbody
							class="divide-y divide-slate-100 text-slate-800 dark:divide-slate-800 dark:text-slate-200"
						>
							{#if store.filteredRequisitions.length === 0}
								<tr>
									<td colspan="9" class="p-8 text-center text-slate-400">
										ไม่พบรายการคำขอเบิกตามเงื่อนไขที่ค้นหา
									</td>
								</tr>
							{:else}
								{#each store.filteredRequisitions as ticket (ticket.ticket_code)}
									{@const badge = getStatusBadge(ticket.status)}
									<tr class="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
										<!-- 1. รหัส TICKET -->
										<td class="p-3.5 align-top font-mono font-bold">
											<div class="text-blue-600 dark:text-blue-400">{ticket.ticket_code}</div>
											<span
												class="mt-1 inline-block rounded px-2 py-0.5 font-sans text-[10px] font-semibold {ticket.distribution_mode ===
												'permanent'
													? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
													: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'}"
											>
												{ticket.distribution_mode === 'permanent' ? 'ส่งเบิกขาด' : 'ยืม-คืน'}
											</span>
										</td>

										<!-- 2. รายการสินค้า -->
										<td class="p-3.5 align-top">
											<div class="font-bold text-slate-900 dark:text-slate-100">
												{ticket.items.map((i) => i.name).join(', ')}
											</div>
											<div class="mt-1 text-[11px] leading-snug text-slate-500">
												{ticket.hub_name}
											</div>
											<div class="mt-0.5 font-mono text-[10px] text-slate-400">
												เบิก {ticket.total_requested} = แจก {ticket.total_distributed} + ชำรุด {ticket.total_damaged}
												+ คืน {ticket.total_returned}
											</div>
										</td>

										<!-- 3. ยอดเบิกทั้งหมด -->
										<td class="p-3.5 text-center align-top font-extrabold">
											{ticket.total_requested}
											{ticket.items[0]?.unit || 'รายการ'}
										</td>

										<!-- 4. แจกจ่ายสำเร็จแล้ว -->
										<td class="p-3.5 text-center align-top">
											<span
												class="rounded-md bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
											>
												{ticket.total_distributed}
												{ticket.items[0]?.unit || ''}
											</span>
										</td>

										<!-- 5. ชำรุด/สูญหาย -->
										<td
											class="p-3.5 text-center align-top font-bold text-slate-600 dark:text-slate-400"
										>
											{ticket.total_damaged || 0}
										</td>

										<!-- 6. ยอดคืนอนุมัติ -->
										<td
											class="p-3.5 text-center align-top font-bold text-slate-600 dark:text-slate-400"
										>
											{ticket.total_returned || 0}
										</td>

										<!-- 7. สถานะ -->
										<td class="p-3.5 text-center align-top">
											<span
												class="inline-block rounded-full border px-2.5 py-1 text-xs font-semibold {badge.class}"
											>
												{badge.label}
											</span>
										</td>

										<!-- 8. วันที่ -->
										<td
											class="p-3.5 text-center align-top text-[11px] whitespace-nowrap text-slate-500"
										>
											{ticket.created_at}
										</td>

										<!-- 9. รายละเอียด -->
										<td class="p-3.5 text-center align-top">
											<Button
												variant="ghost"
												size="icon"
												onclick={() => store.openDetailModal(ticket)}
												title="ดูรายละเอียด Ticket"
												class="size-8 text-slate-500 hover:text-blue-600"
											>
												<Eye class="size-4" />
											</Button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- TAB 1 CONTENT: สิ่งของพร้อมแจก (Stock Items) -->
		{#if store.activeTab === 'stock'}
			<div
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
			>
				<!-- Section Header -->
				<div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
					<div>
						<h2
							class="flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-slate-100"
						>
							<Package class="size-5 text-emerald-600" />
							<span>ชุดพัสดุพร้อมแจกจ่ายหน้างาน (Active Batches)</span>
						</h2>
						<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
							เลือกรายการพัสดุเพื่อเปิดจุดแจกจ่ายด่วน (Kiosk Mode) หรือจัดการส่งคืนคลังหลัก
						</p>
					</div>

					<div class="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
						<!-- Search Input -->
						<div class="relative w-full sm:w-64">
							<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
							<Input
								type="text"
								bind:value={store.searchQuery}
								placeholder="ค้นหาชื่อพัสดุ หรือ รหัสชุด..."
								class="pl-9 text-xs"
							/>
						</div>

						<!-- Mode Toggle -->
						<div
							class="inline-flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60"
						>
							<Button
								size="sm"
								variant="ghost"
								class="rounded-lg {store.modeFilter === 'all'
									? 'bg-white shadow-xs dark:bg-slate-900'
									: ''}"
								onclick={() => (store.modeFilter = 'all')}
							>
								ทั้งหมด ({store.readyStockItems.length})
							</Button>
							<Button
								size="sm"
								variant="ghost"
								class="gap-1 rounded-lg {store.modeFilter === 'permanent'
									? 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-600 hover:text-white'
									: ''}"
								onclick={() => (store.modeFilter = 'permanent')}
							>
								<span class="size-1.5 rounded-full bg-current"></span>
								<span>แจกขาด</span>
							</Button>
							<Button
								size="sm"
								variant="ghost"
								class="gap-1 rounded-lg {store.modeFilter === 'borrow_return'
									? 'bg-blue-600 text-white shadow-xs hover:bg-blue-600 hover:text-white'
									: ''}"
								onclick={() => (store.modeFilter = 'borrow_return')}
							>
								<RotateCcw class="size-3" />
								<span>ยืม-คืน</span>
							</Button>
						</div>
					</div>
				</div>

				{#if store.filteredStock.length === 0}
					<!-- Empty State -->
					<div
						class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center dark:border-slate-800"
					>
						<div
							class="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800"
						>
							<Package class="size-6" />
						</div>
						<div>
							<h3 class="text-sm font-bold text-slate-700 dark:text-slate-300">
								ยังไม่มีชุดพัสดุที่พร้อมแจกจ่ายหน้างาน
							</h3>
							<p class="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
								ไปที่แท็บ "ประวัติและคำขอเบิกพัสดุ" แล้วกด "ขอเบิกพัสดุใหม่"
								เพื่อตั้งเบิกเข้ามาที่จุดบริการ
							</p>
						</div>
						<Button onclick={() => store.openCreateModal()} class="gap-2 text-xs font-bold">
							<Plus class="size-3.5" />
							<span>ขอเบิกพัสดุเข้าจุดบริการ</span>
						</Button>
					</div>
				{:else}
					<!-- Stock Item Grid Cards -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
						{#each store.filteredStock as stock (stock.id)}
							<div
								class="flex flex-col justify-between space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
							>
								<div>
									<div class="mb-2 flex items-start justify-between gap-2">
										<span
											class="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300"
										>
											{stock.category}
										</span>
										<span
											class="rounded px-2 py-0.5 text-[10px] font-semibold {stock.mode ===
											'permanent'
												? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
												: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'}"
										>
											{stock.mode === 'permanent' ? '🟢 แจกขาด' : '🔄 ยืม-คืน'}
										</span>
									</div>

									<h3 class="mb-1 text-base font-extrabold text-slate-900 dark:text-slate-100">
										{stock.name}
									</h3>
									<p class="flex items-center gap-1 text-xs text-slate-500">
										<Building2 class="size-3 text-slate-400" />
										<span>{stock.location}</span>
									</p>
								</div>

								<!-- Qty Breakdown -->
								<div
									class="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center text-xs dark:border-slate-800 dark:bg-slate-800/50"
								>
									<div>
										<span class="block text-[10px] font-medium text-slate-400">พร้อมแจก</span>
										<span class="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
											{stock.availableQuantity}
										</span>
									</div>
									<div>
										<span class="block text-[10px] font-medium text-slate-400">แจกแล้ว</span>
										<span class="text-sm font-bold text-slate-700 dark:text-slate-300">
											{stock.distributedQuantity}
										</span>
									</div>
									<div>
										<span class="block text-[10px] font-medium text-slate-400">ชำรุด</span>
										<span class="text-sm font-bold text-rose-500">
											{stock.damagedQuantity || 0}
										</span>
									</div>
								</div>

								<!-- Action Button -->
								<Button
									disabled={stock.availableQuantity <= 0}
									onclick={() => store.openDistributeModal(stock)}
									class="w-full gap-2 bg-emerald-600 text-xs font-bold hover:bg-emerald-500"
								>
									<Send class="size-3.5" />
									<span>แจกจ่ายหน้างาน ({stock.unit})</span>
								</Button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Modals -->
	<CreateRequisitionDialog />
	<DistributeItemDialog />
	<ReturnItemDialog />
	<TicketDetailDialog />
</div>
