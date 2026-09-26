<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Layers from '@lucide/svelte/icons/layers';
	import Loader from '@lucide/svelte/icons/loader';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { resolve } from '$app/paths';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		resolveAuthenticatedAuthorContext,
		useRequisitionTickets,
		useReceiveTicketAtDistributionPoint
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import { getTicketStatusLabel } from '../model/ticket-status';
	import Lock from '@lucide/svelte/icons/lock';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import FoodDistributionCard from './FoodDistributionCard.svelte';
	import SuppliesDistributionCard from './SuppliesDistributionCard.svelte';
	import LoanReturnCard from './LoanReturnCard.svelte';
	import ShiftReconciliationCard from './ShiftReconciliationCard.svelte';
	import { formatDistributionError } from '../model/distribution-error';
	import * as Select from '$lib/components/ui/select/index.js';

	interface Props {
		initialTab?: 'receive' | 'food' | 'supplies' | 'returns' | 'reconciliation';
	}

	let { initialTab = 'food' }: Props = $props();

	const currentShelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Authoritative session context — matches Slice 5.2 TicketActionPanel pattern.
	// Fails closed (canFrontline = false) if unauthenticated.
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(currentShelterCode ?? undefined);
		} catch {
			return null;
		}
	});

	const canFrontline = $derived(authContext ? canPerformFrontlineDistribution(authContext) : false);

	// activeTab is intentionally set once from the initialTab prop; user navigation controls it
	// after mount. A closure breaks the Svelte reactivity chain so Svelte does not warn that
	// only the initial prop value is captured.
	let activeTab = $state<'receive' | 'food' | 'supplies' | 'returns' | 'reconciliation'>(
		(function () {
			return initialTab;
		})()
	);

	// Fetch tickets for frontline station
	const ticketsQuery = useRequisitionTickets(undefined, () => currentShelterCode);
	const allTickets = $derived(ticketsQuery.data ?? []);

	// Categorize tickets by frontline workflow relevance
	const inTransitTickets = $derived(allTickets.filter((t) => t.status === 'IN_TRANSIT'));
	const distributingFoodTickets = $derived(
		allTickets.filter((t) => t.status === 'DISTRIBUTING' && t.requisition_type === 'food')
	);
	const distributingSuppliesTickets = $derived(
		allTickets.filter((t) => t.status === 'DISTRIBUTING' && t.requisition_type === 'supplies')
	);

	// Selected ticket ID for food/supplies
	let selectedFoodTicketId = $state<string>('');
	let selectedSuppliesTicketId = $state<string>('');

	// Auto-select first active ticket if unselected
	$effect(() => {
		if (
			distributingFoodTickets.length > 0 &&
			(!selectedFoodTicketId ||
				!distributingFoodTickets.some((t) => t._id === selectedFoodTicketId))
		) {
			selectedFoodTicketId = distributingFoodTickets[0]._id;
		}
	});

	$effect(() => {
		if (
			distributingSuppliesTickets.length > 0 &&
			(!selectedSuppliesTicketId ||
				!distributingSuppliesTickets.some((t) => t._id === selectedSuppliesTicketId))
		) {
			selectedSuppliesTicketId = distributingSuppliesTickets[0]._id;
		}
	});

	const activeFoodTicket = $derived(
		distributingFoodTickets.find((t) => t._id === selectedFoodTicketId) ?? null
	);
	const activeSuppliesTicket = $derived(
		distributingSuppliesTickets.find((t) => t._id === selectedSuppliesTicketId) ?? null
	);

	// Reconciliation eligible tickets (DISTRIBUTING or post-distribution tickets needing close or submit)
	const reconciliationEligibleTickets = $derived(
		allTickets.filter(
			(t) =>
				t.status === 'DISTRIBUTING' ||
				t.status === 'SHIFT_CLOSED' ||
				t.status === 'RETURN_PENDING_RECEIPT' ||
				t.status === 'RETURN_COMPLETED' ||
				t.status === 'COMPLETED'
		)
	);

	let selectedReconciliationTicketId = $state<string>('');

	$effect(() => {
		if (reconciliationEligibleTickets.length > 0) {
			if (
				!selectedReconciliationTicketId ||
				!reconciliationEligibleTickets.some((t) => t._id === selectedReconciliationTicketId)
			) {
				if (
					activeFoodTicket &&
					reconciliationEligibleTickets.some((t) => t._id === activeFoodTicket._id)
				) {
					selectedReconciliationTicketId = activeFoodTicket._id;
				} else if (
					activeSuppliesTicket &&
					reconciliationEligibleTickets.some((t) => t._id === activeSuppliesTicket._id)
				) {
					selectedReconciliationTicketId = activeSuppliesTicket._id;
				} else {
					selectedReconciliationTicketId = reconciliationEligibleTickets[0]._id;
				}
			}
		}
	});

	const activeReconciliationTicket = $derived(
		reconciliationEligibleTickets.find((t) => t._id === selectedReconciliationTicketId) ?? null
	);

	// Mutation for receiving cargo (IN_TRANSIT -> DISTRIBUTING)
	const receiveMutation = useReceiveTicketAtDistributionPoint();
	let receivingTicketId = $state<string | null>(null);

	async function handleReceiveCargo(ticket: RequisitionTicket) {
		if (!canFrontline) {
			toast.error('คุณไม่มีสิทธิ์ในการตรวจรับพัสดุเข้าจุดแจกจ่าย');
			return;
		}

		receivingTicketId = ticket._id;
		try {
			await receiveMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode: currentShelterCode
			});
			toast.success(`ตรวจรับสินค้าเข้าจุดแจกจ่ายเรียบร้อยแล้ว: ${ticket.ticket_no}`);
			// If received food, switch tab to food; if supplies, switch to supplies
			if (ticket.requisition_type === 'food') {
				activeTab = 'food';
				selectedFoodTicketId = ticket._id;
			} else if (ticket.requisition_type === 'supplies') {
				activeTab = 'supplies';
				selectedSuppliesTicketId = ticket._id;
			}
		} catch (err) {
			toast.error(formatDistributionError(err, 'ไม่สามารถตรวจรับสินค้าได้ กรุณาลองใหม่อีกครั้ง'));
		} finally {
			receivingTicketId = null;
		}
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
	<!-- Back Navigation -->
	<div>
		<a
			href={resolve('/onsite')}
			class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span>กลับหน้าระบบส่วนหน้า (Onsite)</span>
		</a>
	</div>

	<!-- Station 4 Header -->
	<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/80 bg-sky-50 text-sky-700 shadow-xs"
			>
				<Truck class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
					จุดแจกจ่ายพัสดุและอาหาร
				</h1>
				<p class="text-xs font-semibold tracking-wider text-slate-500 uppercase sm:text-sm">
					Distribution Desk (Station 4)
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5">
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-2xs"
			>
				<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
				ศูนย์: {currentShelterCode}
			</span>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 shadow-2xs"
			>
				<Layers class="h-3.5 w-3.5 text-sky-600" />
				จุดแจกจ่ายส่วนหน้า
			</span>
		</div>
	</header>

	<!-- Station Tabs (Operational modes) -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
		<!-- Tab 1: Receive Cargo -->
		<button
			type="button"
			onclick={() => (activeTab = 'receive')}
			class="flex items-center justify-between rounded-xl border p-3.5 text-left transition-all {activeTab ===
			'receive'
				? 'border-sky-500 bg-sky-50/50 shadow-xs ring-2 ring-sky-500/20'
				: 'border-slate-200 bg-white hover:border-slate-300'}"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg {activeTab === 'receive'
						? 'bg-sky-600 text-white'
						: 'bg-slate-100 text-slate-600'}"
				>
					<Truck class="h-4 w-4" />
				</div>
				<div>
					<p class="text-xs font-bold text-slate-900">1. รับของถึงจุดแจก</p>
					<p class="text-2xs text-slate-500">Confirm Cargo Arrival</p>
				</div>
			</div>
			{#if inTransitTickets.length > 0}
				<span
					class="animate-pulse rounded-full bg-blue-100 px-2 py-0.5 text-2xs font-bold text-blue-900"
				>
					รอรับ {inTransitTickets.length}
				</span>
			{/if}
		</button>

		<!-- Tab 2: Food Handover -->
		<button
			type="button"
			onclick={() => (activeTab = 'food')}
			class="flex items-center justify-between rounded-xl border p-3.5 text-left transition-all {activeTab ===
			'food'
				? 'border-amber-500 bg-amber-50/50 shadow-xs ring-2 ring-amber-500/20'
				: 'border-slate-200 bg-white hover:border-slate-300'}"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg {activeTab === 'food'
						? 'bg-amber-600 text-white'
						: 'bg-slate-100 text-slate-600'}"
				>
					<UtensilsCrossed class="h-4 w-4" />
				</div>
				<div>
					<p class="text-xs font-bold text-slate-900">2. แจกอาหารปรุงสุก</p>
					<p class="text-2xs text-slate-500">Ready Meal Handover</p>
				</div>
			</div>
			{#if distributingFoodTickets.length > 0}
				<span class="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-bold text-amber-900">
					เปิดแจก {distributingFoodTickets.length}
				</span>
			{/if}
		</button>

		<!-- Tab 3: Supplies & Loans -->
		<button
			type="button"
			onclick={() => (activeTab = 'supplies')}
			class="flex items-center justify-between rounded-xl border p-3.5 text-left transition-all {activeTab ===
			'supplies'
				? 'border-indigo-500 bg-indigo-50/50 shadow-xs ring-2 ring-indigo-500/20'
				: 'border-slate-200 bg-white hover:border-slate-300'}"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg {activeTab === 'supplies'
						? 'bg-indigo-600 text-white'
						: 'bg-slate-100 text-slate-600'}"
				>
					<Package class="h-4 w-4" />
				</div>
				<div>
					<p class="text-xs font-bold text-slate-900">3. จ่ายพัสดุ & ยืม-คืน</p>
					<p class="text-2xs text-slate-500">Supplies & Loans</p>
				</div>
			</div>
			{#if distributingSuppliesTickets.length > 0}
				<span class="rounded-full bg-indigo-100 px-2 py-0.5 text-2xs font-bold text-indigo-900">
					เปิดแจก {distributingSuppliesTickets.length}
				</span>
			{/if}
		</button>

		<!-- Tab 4: Return Loans -->
		<button
			type="button"
			onclick={() => (activeTab = 'returns')}
			class="flex items-center justify-between rounded-xl border p-3.5 text-left transition-all {activeTab ===
			'returns'
				? 'border-emerald-500 bg-emerald-50/50 shadow-xs ring-2 ring-emerald-500/20'
				: 'border-slate-200 bg-white hover:border-slate-300'}"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg {activeTab === 'returns'
						? 'bg-emerald-600 text-white'
						: 'bg-slate-100 text-slate-600'}"
				>
					<RotateCcw class="h-4 w-4" />
				</div>
				<div>
					<p class="text-xs font-bold text-slate-900">4. รับคืนสิ่งของ</p>
					<p class="text-2xs text-slate-500">Loan Return Counter</p>
				</div>
			</div>
		</button>

		<!-- Tab 5: Shift Close & Returns -->
		<button
			type="button"
			onclick={() => (activeTab = 'reconciliation')}
			class="flex items-center justify-between rounded-xl border p-3.5 text-left transition-all {activeTab ===
			'reconciliation'
				? 'border-teal-500 bg-teal-50/50 shadow-xs ring-2 ring-teal-500/20'
				: 'border-slate-200 bg-white hover:border-slate-300'}"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg {activeTab === 'reconciliation'
						? 'bg-teal-600 text-white'
						: 'bg-slate-100 text-slate-600'}"
				>
					<Lock class="h-4 w-4" />
				</div>
				<div>
					<p class="text-xs font-bold text-slate-900">5. ปิดรอบ & คืนของ</p>
					<p class="text-2xs text-slate-500">Shift Close & Returns</p>
				</div>
			</div>
		</button>
	</div>

	<!-- Main Station Content Surface -->
	{#if ticketsQuery.isPending && allTickets.length === 0}
		<div
			class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-xs text-slate-500 shadow-2xs"
		>
			<Loader class="h-5 w-5 animate-spin text-sky-600" />
			<span>กำลังโหลดข้อมูลตั๋วเบิกจ่าย...</span>
		</div>
	{:else if activeTab === 'receive'}
		<!-- TAB 1: Receive Cargo Surface (Slice 5.3) -->
		<div class="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
			<div class="border-b border-slate-100 pb-3">
				<h2 class="text-base font-bold text-slate-900">
					รายการตั๋วสินค้าที่กำลังนำส่งมายังจุดแจกจ่าย
				</h2>
				<p class="text-xs text-slate-500">
					เมื่อรถขนส่งเดินทางมาถึงจุดแจกจ่าย ให้เจ้าหน้าที่ตรวจนับจำนวนของจริง
					และกดยืนยันรับเพื่อเปลี่ยนสถานะเป็น "กำลังแจกจ่าย"
				</p>
			</div>

			{#if inTransitTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center py-12 text-center text-xs text-slate-500"
				>
					<Truck class="mb-2 h-10 w-10 text-slate-300" />
					<p class="font-semibold text-slate-700">ไม่มีตั๋วสินค้าที่กำลังนำส่งในขณะนี้</p>
					<p class="mt-0.5 text-2xs text-slate-400">
						ตั๋วที่คลังสินค้าปล่อยรถแล้วและกำลังนำส่ง จะแสดงที่นี่เพื่อให้จุดแจกตรวจรับ
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each inTransitTickets as ticket (ticket._id)}
						{@const isReceiving = receivingTicketId === ticket._id}
						<div
							class="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between"
						>
							<div class="space-y-1">
								<div class="flex items-center gap-2">
									<span class="font-mono text-xs font-bold text-slate-800">{ticket.ticket_no}</span>
									<span
										class="rounded-full px-2 py-0.5 text-2xs font-bold {ticket.requisition_type ===
										'food'
											? 'border border-amber-200 bg-amber-50 text-amber-900'
											: 'border border-indigo-200 bg-indigo-50 text-indigo-900'}"
									>
										{ticket.requisition_type === 'food' ? 'อาหารปรุงสำเร็จ' : 'พัสดุบรรเทาทุกข์'}
									</span>
									<span
										class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-2xs font-bold text-blue-900"
									>
										กำลังนำส่ง
									</span>
								</div>

								<div class="flex flex-wrap items-center gap-3 text-2xs text-slate-600">
									<span>จุดปลายทาง: <strong>{ticket.destination_location}</strong></span>
									{#if ticket.driver_name}
										<span>คนขับ: {ticket.driver_name}</span>
									{/if}
									{#if ticket.license_plate}
										<span>ทะเบียน: {ticket.license_plate}</span>
									{/if}
								</div>

								<div class="text-2xs text-slate-500">
									รายการ: {ticket.items
										.map((i) => `${i.item_name} (${i.allocated_qty})`)
										.join(', ')}
								</div>
							</div>

							<div class="flex shrink-0 items-center gap-2">
								<button
									type="button"
									onclick={() => handleReceiveCargo(ticket)}
									disabled={isReceiving || !canFrontline}
									class="inline-flex items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{#if isReceiving}
										<Loader class="h-3.5 w-3.5 animate-spin" />
										<span>กำลังตรวจรับ...</span>
									{:else}
										<CheckCircle2 class="h-3.5 w-3.5" />
										<span>ตรวจรับเข้าจุดแจก</span>
									{/if}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'food'}
		<!-- TAB 2: Food Handover Surface-->
		<div class="space-y-4">
			{#if distributingFoodTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<UtensilsCrossed class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">ไม่มีตั๋วอาหารที่เปิดแจกจ่ายอยู่ในขณะนี้</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						ตั๋วอาหารต้องได้รับการตรวจรับเข้าจุดแจกจ่ายก่อน จึงจะสามารถแจกจ่ายให้ผู้ประสบภัยได้
					</p>
					{#if inTransitTickets.some((t) => t.requisition_type === 'food')}
						<button
							type="button"
							onclick={() => (activeTab = 'receive')}
							class="mt-4 inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
						>
							<Truck class="h-3.5 w-3.5" />
							<span>ไปยังแท็บรับของเพื่อตรวจรับตั๋วอาหารเข้าจุดแจก</span>
						</button>
					{/if}
				</div>
			{:else}
				<!-- Food Ticket Selector Bar -->
				{#if distributingFoodTickets.length > 1}
					<div
						class="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
					>
						<label for="food-ticket-select" class="shrink-0 text-xs font-bold text-slate-700">
							เลือกตั๋วอาหารที่ใช้งาน:
						</label>
						<div class="min-w-0 flex-1">
							<Select.Root type="single" bind:value={selectedFoodTicketId}>
								<Select.Trigger
									id="food-ticket-select"
									aria-label="เลือกตั๋วอาหารที่ใช้งาน"
									class="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-amber-500"
								>
									<span class="truncate">
										{#if activeFoodTicket}
											{activeFoodTicket.ticket_no} - {activeFoodTicket.destination_location} ({activeFoodTicket.items
												.map((i) => i.item_name)
												.join(', ')})
										{:else}
											เลือกตั๋วอาหาร
										{/if}
									</span>
								</Select.Trigger>
								<Select.Content>
									{#each distributingFoodTickets as t (t._id)}
										<Select.Item
											value={t._id}
											label={`${t.ticket_no} - ${t.destination_location} (${t.items
												.map((i) => i.item_name)
												.join(', ')})`}
										/>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}

				{#if activeFoodTicket}
					<FoodDistributionCard ticket={activeFoodTicket} shelterCode={currentShelterCode} />
				{/if}
			{/if}
		</div>
	{:else if activeTab === 'supplies'}
		<!-- TAB 3: Supplies & Loans Surface -->
		<div class="space-y-4">
			{#if distributingSuppliesTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<Package class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">ไม่มีตั๋วพัสดุที่เปิดแจกจ่ายอยู่ในขณะนี้</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						ตั๋วพัสดุต้องได้รับการตรวจรับเข้าจุดแจกจ่ายก่อน จึงจะสามารถแจกจ่ายหรือให้ยืมได้
					</p>
					{#if inTransitTickets.some((t) => t.requisition_type === 'supplies')}
						<button
							type="button"
							onclick={() => (activeTab = 'receive')}
							class="mt-4 inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
						>
							<Truck class="h-3.5 w-3.5" />
							<span>ไปยังแท็บรับของเพื่อตรวจรับตั๋วพัสดุเข้าจุดแจก</span>
						</button>
					{/if}
				</div>
			{:else}
				<!-- Supplies Ticket Selector Bar -->
				{#if distributingSuppliesTickets.length > 1}
					<div
						class="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
					>
						<label for="supplies-ticket-select" class="shrink-0 text-xs font-bold text-slate-700">
							เลือกตั๋วพัสดุที่ใช้งาน:
						</label>
						<div class="min-w-0 flex-1">
							<Select.Root type="single" bind:value={selectedSuppliesTicketId}>
								<Select.Trigger
									id="supplies-ticket-select"
									aria-label="เลือกตั๋วพัสดุที่ใช้งาน"
									class="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-indigo-500"
								>
									<span class="truncate">
										{#if activeSuppliesTicket}
											{activeSuppliesTicket.ticket_no} - {activeSuppliesTicket.destination_location} ({activeSuppliesTicket.items
												.map((i) => i.item_name)
												.join(', ')})
										{:else}
											เลือกตั๋วพัสดุ
										{/if}
									</span>
								</Select.Trigger>
								<Select.Content>
									{#each distributingSuppliesTickets as t (t._id)}
										<Select.Item
											value={t._id}
											label={`${t.ticket_no} - ${t.destination_location} (${t.items
												.map((i) => i.item_name)
												.join(', ')})`}
										/>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}

				{#if activeSuppliesTicket}
					<SuppliesDistributionCard
						ticket={activeSuppliesTicket}
						shelterCode={currentShelterCode}
					/>
				{/if}
			{/if}
		</div>
	{:else if activeTab === 'returns'}
		<!-- TAB 4: Loan Return Surface (Slice 5.5A + 5.5B) -->
		<LoanReturnCard shelterCode={currentShelterCode} />
	{:else if activeTab === 'reconciliation'}
		<!-- TAB 5: Shift Reconciliation & Close Surface -->
		<div class="space-y-4">
			{#if reconciliationEligibleTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<Lock class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">
						ไม่มีตั๋วที่เปิดแจกจ่ายหรือรอส่งคืนในขณะนี้
					</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						เมื่อตั๋วได้รับการตรวจรับเข้าจุดแจกแล้ว จะสามารถปิดรอบและกระทบยอดได้ที่แท็บนี้
					</p>
				</div>
			{:else}
				<!-- Reconciliation Ticket Selector Bar -->
				{#if reconciliationEligibleTickets.length > 1}
					<div
						class="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
					>
						<label
							for="reconciliation-ticket-select"
							class="shrink-0 text-xs font-bold text-slate-700"
						>
							เลือกตั๋วที่ต้องการปิดรอบ / กระทบยอด:
						</label>
						<div class="min-w-0 flex-1">
							<Select.Root type="single" bind:value={selectedReconciliationTicketId}>
								<Select.Trigger
									id="reconciliation-ticket-select"
									aria-label="เลือกตั๋วที่ต้องการปิดรอบหรือกระทบยอด"
									class="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-teal-500"
								>
									<span class="truncate">
										{#if activeReconciliationTicket}
											{activeReconciliationTicket.ticket_no} [{getTicketStatusLabel(
												activeReconciliationTicket.status
											)}] - {activeReconciliationTicket.destination_location}
											({activeReconciliationTicket.items.map((i) => i.item_name).join(', ')})
										{:else}
											เลือกตั๋วเพื่อกระทบยอด
										{/if}
									</span>
								</Select.Trigger>
								<Select.Content>
									{#each reconciliationEligibleTickets as t (t._id)}
										<Select.Item
											value={t._id}
											label={`${t.ticket_no} [${getTicketStatusLabel(t.status)}] - ${t.destination_location} (${t.items
												.map((i) => i.item_name)
												.join(', ')})`}
										/>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}

				<ShiftReconciliationCard
					ticket={activeReconciliationTicket}
					shelterCode={currentShelterCode}
				/>
			{/if}
		</div>
	{/if}
</div>
