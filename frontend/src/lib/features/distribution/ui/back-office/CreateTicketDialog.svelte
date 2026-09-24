<script lang="ts">
	import type { ItemMaster } from '$lib/features/catalog';
	import type { Flow2RequisitionType, MealPeriod } from '../../domain/food-supplies';
	import { useCreateRequisitionTicket } from '../../application/queries';
	import { useShelter } from '$lib/features/shelters';
	import { MEAL_PERIOD_LABELS } from '../model/ticket-status';
	import {
		isEligibleDistributionCatalogItem,
		getReturnableBadgeLabel,
		getReturnableBadgeClass
	} from '../model/catalog-eligibility';
	import { validatePositiveQuantity, buildCreateTicketItem } from '../model/ticket-quantity';
	import CatalogItemPicker from './CatalogItemPicker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Package from '@lucide/svelte/icons/package';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface SelectedTicketItem {
		master: ItemMaster;
		requested_qty: string;
	}

	interface Props {
		open: boolean;
		shelterCode: string;
		onCreated: () => void;
		onClose: () => void;
	}

	let { open = $bindable(false), shelterCode, onCreated, onClose }: Props = $props();

	const createMutation = useCreateRequisitionTicket();
	const shelterQuery = useShelter(() => shelterCode);

	// Form states
	let requisitionType = $state<Flow2RequisitionType>('food');
	let destinationLocation = $state('');
	let meal = $state<MealPeriod | undefined>('breakfast');
	let notes = $state('');
	let selectedItems = $state<SelectedTicketItem[]>([]);
	let pickerOpen = $state(false);

	// Available destination suggestions from shelter zones and food distribution points
	const destinationSuggestions = $derived.by(() => {
		const list: string[] = [];
		const shelter = shelterQuery.data;
		if (shelter) {
			if (shelter.zones) {
				for (const z of shelter.zones) {
					if (z.name && !list.includes(z.name)) list.push(z.name);
				}
			}
			if (shelter.food_distribution_points) {
				for (const p of shelter.food_distribution_points) {
					if (p.name && !list.includes(p.name)) list.push(p.name);
				}
			}
		}
		return list;
	});

	// Handle type switch: clear meal if supplies, clear incompatible items
	function handleTypeChange(newType: Flow2RequisitionType) {
		if (requisitionType === newType) return;
		requisitionType = newType;

		if (newType === 'supplies') {
			meal = undefined;
		} else {
			meal = 'breakfast';
		}

		// Clean up incompatible items
		const remaining = selectedItems.filter((item) =>
			isEligibleDistributionCatalogItem(item.master, newType)
		);
		if (remaining.length < selectedItems.length) {
			toast.info('นำรายการที่ไม่ตรงกับประเภทตั๋วใหม่ออกจากรายการแล้ว');
		}
		selectedItems = remaining;
	}

	function handleAddItem(master: ItemMaster, requestedQty: string) {
		// Prevent duplicates
		if (selectedItems.some((item) => item.master._id === master._id)) {
			toast.error('รายการนี้ถูกเพิ่มในตั๋วแล้ว');
			return;
		}
		selectedItems = [...selectedItems, { master, requested_qty: requestedQty }];
		pickerOpen = false;
	}

	function handleRemoveItem(itemId: string) {
		selectedItems = selectedItems.filter((item) => item.master._id !== itemId);
	}

	function resetForm() {
		requisitionType = 'food';
		destinationLocation = '';
		meal = 'breakfast';
		notes = '';
		selectedItems = [];
		pickerOpen = false;
	}

	async function handleSubmit() {
		// 1. Validation: Destination
		const destination = destinationLocation.trim();
		if (!destination) {
			toast.error('กรุณาระบุจุดหมายปลายทางในการส่งมอบ');
			return;
		}

		// 2. Validation: Meal
		if (requisitionType === 'food' && !meal) {
			toast.error('ตั๋วเบิกจ่ายอาหารต้องระบุมื้ออาหาร (เช้า, กลางวัน, เย็น, อาหารว่าง)');
			return;
		}

		// 3. Validation: Items count
		if (selectedItems.length === 0) {
			toast.error('กรุณาเลือกรายการพัสดุหรืออาหารอย่างน้อย 1 รายการ');
			return;
		}

		// 4. Validation: Quantities and Duplicates and Category eligibility
		const seenItemIds: Record<string, boolean> = {};
		for (const item of selectedItems) {
			if (seenItemIds[item.master._id]) {
				toast.error(`พบรายการซ้ำ: ${item.master.name}`);
				return;
			}
			seenItemIds[item.master._id] = true;

			const qtyValidation = validatePositiveQuantity(item.requested_qty);
			if (!qtyValidation.isValid) {
				toast.error(`จำนวนเบิกของ ${item.master.name} ต้องมากกว่า 0`);
				return;
			}

			if (!isEligibleDistributionCatalogItem(item.master, requisitionType)) {
				toast.error(`รายการ ${item.master.name} ไม่ถูกต้องสำหรับตั๋วประเภท ${requisitionType}`);
				return;
			}
		}

		// 5. Construct ticket input (Flow 2 contract)
		const ticketNo = `TKT-${requisitionType.toUpperCase()}-${Date.now()}`;
		const sourceLocation = requisitionType === 'food' ? 'ครัวกลาง' : 'คลังสินค้า';

		const input = {
			ticket_no: ticketNo,
			requisition_type: requisitionType,
			...(requisitionType === 'food' && meal ? { meal } : {}),
			source_location: sourceLocation,
			destination_location: destination,
			items: selectedItems.map(buildCreateTicketItem),
			...(notes.trim() ? { notes: notes.trim() } : {})
		};

		try {
			// Mutation strictly terminates at PENDING_PICK
			await createMutation.mutateAsync({
				input,
				shelterCode
			});

			toast.success(`สร้างใบเบิกจ่าย ${ticketNo} สำเร็จ (รอจัดของ)`);
			resetForm();
			open = false;
			onCreated();
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างใบเบิกจ่าย';
			toast.error(msg);
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			resetForm();
			onClose();
		}
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-[750px]">
		<!-- Header -->
		<div class="border-b border-slate-200/80 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="text-xl font-bold text-slate-900">
					สร้างใบเบิกจ่ายพัสดุและอาหาร
				</Dialog.Title>
				<Dialog.Description class="text-xs text-slate-500">
					ออกตั๋วเบิกจ่ายใหม่เพื่อรอให้คลังสินค้าจัดของ (PENDING_PICK)
					โดยแยกหมวดหมู่อาหารปรุงสุกและพัสดุชัดเจน
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Scrollable Form Body -->
		<div class="flex-1 space-y-6 overflow-y-auto p-6">
			<!-- Step 1: Requisition Type (Food XOR Supplies) -->
			<fieldset class="m-0 space-y-2 border-0 p-0">
				<legend class="text-sm font-semibold text-slate-700">
					ประเภทการเบิกจ่าย <span class="text-red-500">*</span>
				</legend>
				<div class="grid grid-cols-2 gap-3" role="radiogroup" aria-label="ประเภทการเบิกจ่าย">
					<button
						type="button"
						role="radio"
						aria-checked={requisitionType === 'food'}
						onclick={() => handleTypeChange('food')}
						class="flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all {requisitionType ===
						'food'
							? 'border-[#0A2647] bg-[#0A2647]/5 ring-1 ring-[#0A2647]'
							: 'border-slate-200 bg-white hover:bg-slate-50'}"
					>
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {requisitionType ===
							'food'
								? 'bg-[#0A2647] text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							<Utensils class="h-5 w-5" />
						</div>
						<div>
							<div class="text-sm font-bold text-slate-900">อาหารปรุงสุก (Food)</div>
							<div class="text-xs text-slate-500">เฉพาะอาหารพร้อมรับประทาน (Ready-Meal)</div>
						</div>
					</button>

					<button
						type="button"
						role="radio"
						aria-checked={requisitionType === 'supplies'}
						onclick={() => handleTypeChange('supplies')}
						class="flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all {requisitionType ===
						'supplies'
							? 'border-[#0A2647] bg-[#0A2647]/5 ring-1 ring-[#0A2647]'
							: 'border-slate-200 bg-white hover:bg-slate-50'}"
					>
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {requisitionType ===
							'supplies'
								? 'bg-[#0A2647] text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							<Package class="h-5 w-5" />
						</div>
						<div>
							<div class="text-sm font-bold text-slate-900">พัสดุและสิ่งของ (Supplies)</div>
							<div class="text-xs text-slate-500">สิ่งของบรรเทาทุกข์ เครื่องนอน และอุปกรณ์</div>
						</div>
					</button>
				</div>
			</fieldset>

			<!-- Step 2: Destination Location -->
			<div class="space-y-1.5">
				<label for="destination-input" class="text-sm font-semibold text-slate-700">
					จุดหมายปลายทาง / จุดแจกจ่าย <span class="text-red-500">*</span>
				</label>
				<div class="flex gap-2">
					<Input
						id="destination-input"
						type="text"
						bind:value={destinationLocation}
						placeholder="เช่น เต็นท์โซน A, จุดแจกจ่ายโรงอาหารกลาง"
						list="destination-list"
						class="h-10 flex-1 rounded-lg text-sm shadow-2xs placeholder:text-slate-400"
					/>
					<datalist id="destination-list">
						{#each destinationSuggestions as dest (dest)}
							<option value={dest}></option>
						{/each}
					</datalist>
				</div>
				<p class="text-xs text-slate-500">
					ตั๋ว 1 ใบส่งมอบตรงไปยังจุดหมายเดียวเท่านั้น ทุกรายการในตั๋วนี้จะถูกนำส่งร่วมกัน
				</p>
			</div>

			<!-- Step 3: Meal Period (Only if Food) -->
			{#if requisitionType === 'food'}
				<fieldset class="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
					<legend class="text-sm font-semibold text-slate-800">
						มื้ออาหารสำหรับแจกจ่าย <span class="text-red-500">*</span>
					</legend>
					<div
						class="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4"
						role="radiogroup"
						aria-label="มื้ออาหารสำหรับแจกจ่าย"
					>
						{#each ['breakfast', 'lunch', 'dinner', 'snack'] as const as m (m)}
							<button
								type="button"
								role="radio"
								aria-checked={meal === m}
								onclick={() => (meal = m)}
								class="flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition-all {meal ===
								m
									? 'border-amber-600 bg-amber-600 text-white shadow-xs'
									: 'border-amber-200 bg-white text-slate-700 hover:bg-amber-50'}"
							>
								มื้อ{MEAL_PERIOD_LABELS[m]}
							</button>
						{/each}
					</div>
					<p class="mt-1 text-xs text-amber-800/80">
						ระบบใช้มื้ออาหารในการตรวจสอบสิทธิ์รับอาหารซ้ำของผู้พักพิงในรอบวัน (Thailand
						Calendar-Day)
					</p>
				</fieldset>
			{/if}

			<!-- Step 4: Items Section -->
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<h4 class="text-sm font-bold text-slate-900">
							รายการที่ต้องการเบิก ({selectedItems.length} รายการ)
						</h4>
						<p class="text-xs text-slate-500">ระบุจำนวนที่ต้องการเบิกจ่ายจริง</p>
					</div>

					<button
						type="button"
						onclick={() => (pickerOpen = true)}
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0A2647] shadow-2xs transition-colors hover:bg-slate-50"
					>
						<Plus class="h-3.5 w-3.5" />
						<span>+ เพิ่มรายการ</span>
					</button>
				</div>

				{#if selectedItems.length === 0}
					<div
						class="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center"
					>
						<Package class="mx-auto mb-2 h-8 w-8 text-slate-400" />
						<p class="text-xs font-semibold text-slate-700">ยังไม่ได้เลือกรายการในตั๋วนี้</p>
						<p class="mt-0.5 text-xs text-slate-500">
							กดปุ่ม "+ เพิ่มรายการ" ด้านบนเพื่อค้นหาจาก Master Catalog
						</p>
					</div>
				{:else}
					<div class="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
						<table class="w-full min-w-[460px] text-left text-sm">
							<thead
								class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wider text-slate-600 uppercase"
							>
								<tr>
									<th class="py-2.5 pr-2 pl-4">ชื่อรายการ</th>
									<th class="px-2 py-2.5 text-center">ประเภทการแจก</th>
									<th class="px-2 py-2.5 text-right">จำนวนที่เบิก</th>
									<th class="py-2.5 pr-4 pl-2 text-right"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each selectedItems as item (item.master._id)}
									<tr class="hover:bg-slate-50/50">
										<td class="py-2.5 pr-2 pl-4">
											<div class="font-bold text-slate-900">{item.master.name}</div>
											<div class="text-xs text-slate-500">
												หน่วย: {item.master.base_unit}
												{#if item.master.sku}
													• SKU: {item.master.sku}{/if}
											</div>
										</td>
										<td class="px-2 py-2.5 text-center">
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getReturnableBadgeClass(
													item.master.returnable
												)}"
											>
												{getReturnableBadgeLabel(item.master.returnable)}
											</span>
										</td>
										<td class="px-2 py-2.5 text-right">
											<div class="inline-flex items-center gap-1.5">
												<Input
													type="text"
													inputmode="decimal"
													bind:value={item.requested_qty}
													aria-label="จำนวนเบิก {item.master.name}"
													class="h-8 w-20 text-right text-xs font-bold tabular-nums"
												/>
												<span class="text-xs text-slate-500">{item.master.base_unit}</span>
											</div>
										</td>
										<td class="py-2.5 pr-4 pl-2 text-right">
											<button
												type="button"
												onclick={() => handleRemoveItem(item.master._id)}
												class="rounded-md p-1 text-slate-400 transition-colors hover:text-red-600"
												title="ลบรายการ"
												aria-label="ลบรายการ {item.master.name}"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Step 5: Notes -->
			<div class="space-y-1.5">
				<label for="ticket-notes" class="text-sm font-semibold text-slate-700">
					หมายเหตุเพิ่มเติม (ถ้ามี)
				</label>
				<Textarea
					id="ticket-notes"
					bind:value={notes}
					rows={2}
					placeholder="เช่น เบิกด่วนสำหรับผู้พักพิงกลุ่มเปราะบาง, ส่งมอบภายใน 12:00 น."
					class="w-full text-sm shadow-2xs placeholder:text-slate-400"
				/>
			</div>
		</div>

		<!-- Footer Actions -->
		<div
			class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/75 px-6 py-4"
		>
			<div class="flex items-center gap-1.5 text-xs text-slate-500">
				<AlertCircle class="h-3.5 w-3.5 text-slate-400" />
				<span>เมื่อสร้างสำเร็จ ตั๋วจะอยู่ในสถานะ "รอจัดของ" (PENDING_PICK)</span>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => {
						resetForm();
						open = false;
						onClose();
					}}
					class="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
				>
					ยกเลิก
				</button>

				<button
					type="button"
					onclick={handleSubmit}
					disabled={createMutation.isPending}
					class="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0A2647] px-4 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if createMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" />
						<span>กำลังบันทึก...</span>
					{:else}
						<span>ยืนยันสร้างใบเบิกจ่าย</span>
					{/if}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Catalog Item Picker Modal -->
<CatalogItemPicker
	bind:open={pickerOpen}
	{requisitionType}
	alreadySelectedItemIds={selectedItems.map((i) => i.master._id)}
	onSelectItem={handleAddItem}
	onClose={() => (pickerOpen = false)}
/>
