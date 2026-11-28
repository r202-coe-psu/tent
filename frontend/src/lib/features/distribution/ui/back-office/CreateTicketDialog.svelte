<script lang="ts">
	import { formatUnit, useUnitsOfMeasure, type ItemMaster } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import {
		thailandCalendarDay,
		type Flow2RequisitionType,
		type MealPeriod
	} from '../../domain/food-supplies';
	import { useCreateRequisitionTicket } from '../../application/queries';
	import { useShelter } from '$lib/features/shelters';
	import { MEAL_PERIOD_LABELS } from '../model/ticket-status';
	import {
		isEligibleDistributionCatalogItem,
		getReturnableBadgeLabel,
		getReturnableBadgeClass
	} from '../model/catalog-eligibility';
	import { validatePositiveQuantity, buildCreateTicketItem } from '../model/ticket-quantity';
	import { formatDistributionError } from '../model/distribution-error';
	import { formatServiceDay } from '../model/service-day';
	import {
		buildDestinationOptionGroups,
		resolveDestinationSelection,
		CUSTOM_DESTINATION_SENTINEL
	} from '../model/destination-selector';
	import CatalogItemPicker from './CatalogItemPicker.svelte';
	import DatePicker from '$lib/components/date-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Package from '@lucide/svelte/icons/package';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	const unitsQuery = useUnitsOfMeasure();
	const unitLabel = (code: string) =>
		formatUnit(code, unitsQuery.data ?? [], langState.current) || code;

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
	// Holds a known destination string, the CUSTOM_DESTINATION_SENTINEL, or '' (nothing selected).
	// Bits UI Select requires a string — never undefined.
	let destinationSelection = $state('');
	let customDestinationText = $state('');
	let meal = $state<MealPeriod | undefined>('breakfast');
	// The page may stay open past midnight, so the Thailand day is read again each time the dialog
	// opens (`open` is the dependency) rather than once when the page loaded.
	const today = $derived.by(() => {
		void open;
		return thailandCalendarDay();
	});
	// Follows `today`, so it starts on the new day when reopened; the user's pick overrides it.
	let serviceDate = $derived(today);
	let notes = $state('');
	let selectedItems = $state<SelectedTicketItem[]>([]);
	/** Inline errors stay hidden until the first submit attempt, then track edits live. */
	let submitAttempted = $state(false);
	const fieldErrors = $derived.by(() => {
		const destination = resolveDestinationSelection(destinationSelection, customDestinationText)
			? undefined
			: isCustomDestination
				? 'กรุณาพิมพ์ชื่อจุดหมายปลายทาง'
				: 'กรุณาเลือกจุดหมายปลายทาง';
		const serviceDay =
			requisitionType === 'food' && (!serviceDate || serviceDate < thailandCalendarDay())
				? 'วันที่แจกต้องเป็นวันนี้หรือวันถัดไป'
				: undefined;
		const items = selectedItems.length === 0 ? 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ' : undefined;
		return { destination, serviceDay, items };
	});
	const hasFieldErrors = $derived(
		!!(fieldErrors.destination || fieldErrors.serviceDay || fieldErrors.items)
	);
	function qtyError(raw: string): string | undefined {
		const v = validatePositiveQuantity(raw);
		return v.isValid ? undefined : (v.error ?? 'จำนวนต้องมากกว่า 0');
	}
	let pickerOpen = $state(false);

	// Grouped destination options from shelter zones and food distribution points
	const destinationOptions = $derived(buildDestinationOptionGroups(shelterQuery.data));
	const isCustomDestination = $derived(destinationSelection === CUSTOM_DESTINATION_SENTINEL);

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

	function handleItemQtyBlur(itemId: string, raw: string) {
		const item = selectedItems.find((i) => i.master._id === itemId);
		if (!item) return;
		validatePositiveQuantity(raw);
	}

	function resetForm() {
		requisitionType = 'food';
		destinationSelection = '';
		customDestinationText = '';
		meal = 'breakfast';
		serviceDate = thailandCalendarDay();
		notes = '';
		selectedItems = [];
		pickerOpen = false;
		submitAttempted = false;
	}

	async function handleSubmit() {
		submitAttempted = true;
		const destination = resolveDestinationSelection(destinationSelection, customDestinationText);
		const qtyInvalid = selectedItems.some((item) => qtyError(item.requested_qty));
		if (!destination || hasFieldErrors || qtyInvalid) {
			toast.error('กรุณาแก้ไขช่องที่ไม่ถูกต้อง');
			document.querySelector<HTMLElement>('[data-create-ticket] [aria-invalid="true"]')?.focus();
			return;
		}

		// 4. Validation: Quantities, duplicates, and category eligibility
		const seenItemIds: Record<string, boolean> = {};
		for (const item of selectedItems) {
			if (seenItemIds[item.master._id]) {
				toast.error(`พบรายการซ้ำ: ${item.master.name}`);
				return;
			}
			seenItemIds[item.master._id] = true;

			const validation = validatePositiveQuantity(item.requested_qty);
			if (!validation.isValid) {
				toast.error(
					validation.error ?? `จำนวนเบิกของ ${item.master.name} ต้องเป็นจำนวนเต็มที่ถูกต้อง`
				);
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
			...(requisitionType === 'food' && meal ? { meal, service_date: serviceDate } : {}),
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
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการสร้างใบเบิกจ่าย กรุณาลองใหม่อีกครั้ง'
			);
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
					ออกตั๋วเบิกจ่ายใหม่เพื่อรอให้คลังสินค้าจัดของ โดยแยกหมวดหมู่อาหารปรุงสุกและพัสดุชัดเจน
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Scrollable Form Body -->
		<div class="flex-1 space-y-7 overflow-y-auto p-6" data-create-ticket>
			<!-- Step 1: Requisition Type (Food XOR Supplies) -->
			<fieldset class="min-w-0 border-0 p-0">
				<legend class="mb-2.5 text-sm font-semibold text-slate-700">
					ประเภทการเบิกจ่าย <span class="text-red-500">*</span>
				</legend>
				<RadioGroup.Root
					value={requisitionType}
					onValueChange={(next) => handleTypeChange(next as Flow2RequisitionType)}
					class="grid grid-cols-2 gap-3"
					aria-label="ประเภทการเบิกจ่าย"
				>
					<label
						for="requisition-food"
						class="flex h-full cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-all {requisitionType ===
						'food'
							? 'border-[#0A2647] bg-white shadow-xs ring-2 ring-[#0A2647]/15'
							: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}"
					>
						<RadioGroup.Item value="food" id="requisition-food" class="mt-0" />
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {requisitionType ===
							'food'
								? 'bg-[#0A2647] text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							<Utensils class="h-5 w-5" />
						</div>
						<div>
							<div class="text-sm font-bold text-slate-900">อาหารปรุงสุก</div>
							<div class="text-xs text-slate-500">เฉพาะอาหารพร้อมรับประทาน</div>
						</div>
					</label>

					<label
						for="requisition-supplies"
						class="flex h-full cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-all {requisitionType ===
						'supplies'
							? 'border-[#0A2647] bg-white shadow-xs ring-2 ring-[#0A2647]/15'
							: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}"
					>
						<RadioGroup.Item value="supplies" id="requisition-supplies" class="mt-0" />
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {requisitionType ===
							'supplies'
								? 'bg-[#0A2647] text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							<Package class="h-5 w-5" />
						</div>
						<div>
							<div class="text-sm font-bold text-slate-900">พัสดุและสิ่งของ</div>
							<div class="text-xs text-slate-500">สิ่งของบรรเทาทุกข์ เครื่องนอน และอุปกรณ์</div>
						</div>
					</label>
				</RadioGroup.Root>
			</fieldset>

			<!-- Step 2: Destination Location -->
			<div class="space-y-2">
				<label for="destination-select" class="block text-sm font-semibold text-slate-700">
					จุดหมายปลายทาง / จุดแจกจ่าย <span class="text-red-500">*</span>
				</label>
				<Select.Root type="single" bind:value={destinationSelection}>
					<Select.Trigger
						id="destination-select"
						aria-label="เลือกจุดหมายปลายทาง"
						aria-invalid={submitAttempted && !!fieldErrors.destination && !isCustomDestination}
						aria-describedby={submitAttempted && fieldErrors.destination
							? 'destination-error'
							: undefined}
						class="h-10 w-full rounded-lg text-sm shadow-2xs"
					>
						<span class="truncate">
							{isCustomDestination
								? 'ระบุจุดหมายอื่น...'
								: destinationSelection || 'เลือกโซนหรือจุดแจกจ่าย...'}
						</span>
					</Select.Trigger>
					<Select.Content viewportClass="max-h-[260px]">
						{#if destinationOptions.zones.length > 0}
							<Select.Group>
								<Select.GroupHeading>โซนที่พัก</Select.GroupHeading>
								{#each destinationOptions.zones as zone (zone.value)}
									<Select.Item value={zone.value} label={zone.label} />
								{/each}
							</Select.Group>
						{/if}
						{#if destinationOptions.foodDistributionPoints.length > 0}
							{#if destinationOptions.zones.length > 0}
								<Select.Separator />
							{/if}
							<Select.Group>
								<Select.GroupHeading>จุดแจกจ่ายอาหาร</Select.GroupHeading>
								{#each destinationOptions.foodDistributionPoints as point (point.value)}
									<Select.Item value={point.value} label={point.label} />
								{/each}
							</Select.Group>
						{/if}
						<Select.Separator />
						<Select.Item value={CUSTOM_DESTINATION_SENTINEL} label="ระบุจุดหมายอื่น..." />
					</Select.Content>
				</Select.Root>

				{#if isCustomDestination}
					<Input
						id="destination-custom-input"
						type="text"
						bind:value={customDestinationText}
						placeholder="พิมพ์ชื่อจุดหมายปลายทางที่ต้องการ..."
						aria-invalid={submitAttempted && !!fieldErrors.destination}
						aria-describedby={submitAttempted && fieldErrors.destination
							? 'destination-error'
							: undefined}
						class="h-10 w-full rounded-lg text-sm shadow-2xs placeholder:text-slate-400"
					/>
				{/if}

				{#if submitAttempted && fieldErrors.destination}
					<p id="destination-error" class="text-sm font-medium text-destructive" role="alert">
						{fieldErrors.destination}
					</p>
				{/if}
				<p class="text-xs text-slate-500">
					ตั๋ว 1 ใบส่งมอบตรงไปยังจุดหมายเดียวเท่านั้น ทุกรายการในตั๋วนี้จะถูกนำส่งร่วมกัน
				</p>
			</div>

			<!-- Step 3: Meal Period (Only if Food) -->
			{#if requisitionType === 'food'}
				<fieldset class="min-w-0 rounded-xl border border-amber-200 bg-amber-50/40 p-5">
					<legend class="float-left mb-3 w-full text-sm font-semibold text-slate-800">
						มื้ออาหารสำหรับแจกจ่าย <span class="text-red-500">*</span>
					</legend>
					<RadioGroup.Root
						bind:value={meal}
						class="clear-both grid grid-cols-2 gap-2 sm:grid-cols-4"
						aria-label="มื้ออาหารสำหรับแจกจ่าย"
					>
						{#each ['breakfast', 'lunch', 'dinner', 'snack'] as const as m (m)}
							<label
								for="meal-{m}"
								class="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-all {meal ===
								m
									? 'border-amber-600 bg-amber-600 text-white shadow-xs'
									: 'border-amber-200 bg-white text-slate-700 hover:bg-amber-50'}"
							>
								<RadioGroup.Item value={m} id="meal-{m}" class="hidden" />
								<span>มื้อ{MEAL_PERIOD_LABELS[m]}</span>
							</label>
						{/each}
					</RadioGroup.Root>
					<p class="mt-2 text-xs text-amber-800/80">
						ระบบใช้มื้ออาหารในการตรวจสอบสิทธิ์รับอาหารซ้ำของผู้พักพิงในรอบวัน
					</p>

					<div class="mt-5 space-y-2 border-t border-amber-200/70 pt-5">
						<label for="service-date" class="block text-sm font-semibold text-slate-800">
							วันที่แจก <span class="text-red-500">*</span>
						</label>
						<DatePicker
							id="service-date"
							invalid={submitAttempted && !!fieldErrors.serviceDay}
							min={today}
							bind:value={serviceDate}
							format={(iso) => formatServiceDay(iso, today)}
							class="!h-10 bg-white sm:w-56"
						/>
						{#if submitAttempted && fieldErrors.serviceDay}
							<p class="text-sm font-medium text-destructive" role="alert">
								{fieldErrors.serviceDay}
							</p>
						{:else if serviceDate}
							<p class="text-xs text-amber-800/80">
								ตั๋วนี้จะอยู่ในรอบแจก {formatServiceDay(serviceDate, today)} ของจุดแจก
							</p>
						{/if}
					</div>
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

					<Button
						type="button"
						variant="outline"
						onclick={() => (pickerOpen = true)}
						class="text-xs font-semibold text-[#0A2647] shadow-2xs hover:text-[#0A2647]"
					>
						<Plus class="h-3.5 w-3.5" />
						<span>เพิ่มรายการ</span>
					</Button>
				</div>

				{#if selectedItems.length === 0}
					<div
						class="rounded-xl border border-dashed p-8 text-center {submitAttempted &&
						fieldErrors.items
							? 'border-red-300 bg-red-50/40'
							: 'border-slate-300 bg-slate-50/50'}"
					>
						<Package class="mx-auto mb-2 h-8 w-8 text-slate-400" />
						<p class="text-xs font-semibold text-slate-700">ยังไม่ได้เลือกรายการในตั๋วนี้</p>
						<p class="mt-0.5 text-xs text-slate-500">
							กดปุ่ม "เพิ่มรายการ" ด้านบนเพื่อค้นหาจากรายการสินค้า
						</p>
						{#if submitAttempted && fieldErrors.items}
							<p class="mt-2 text-sm font-medium text-destructive" role="alert">
								{fieldErrors.items}
							</p>
						{/if}
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
												หน่วย: {unitLabel(item.master.base_unit)}
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
											<div class="inline-flex flex-col items-end gap-1">
												<div class="inline-flex items-center gap-1.5">
													<Input
														type="text"
														inputmode="numeric"
														step="1"
														min="1"
														bind:value={item.requested_qty}
														onblur={() => {
															handleItemQtyBlur(item.master._id, item.requested_qty);
														}}
														aria-label="จำนวนเบิก {item.master.name}"
														aria-invalid={!!qtyError(item.requested_qty)}
														class="h-8 w-20 text-right text-xs font-bold tabular-nums"
													/>
													<span class="text-xs text-slate-500"
														>{unitLabel(item.master.base_unit)}</span
													>
												</div>
												{#if qtyError(item.requested_qty)}
													<p class="text-xs font-medium text-destructive" role="alert">
														{qtyError(item.requested_qty)}
													</p>
												{/if}
											</div>
										</td>
										<td class="py-2.5 pr-4 pl-2 text-right">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												onclick={() => handleRemoveItem(item.master._id)}
												title="ลบรายการ"
												aria-label="ลบรายการ {item.master.name}"
												class="text-slate-400 hover:text-red-600"
											>
												<Trash2 class="h-4 w-4" />
											</Button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Step 5: Notes -->
			<div class="space-y-2">
				<label for="ticket-notes" class="block text-sm font-semibold text-slate-700">
					หมายเหตุเพิ่มเติม
					<span class="ml-1 text-xs font-normal text-slate-500">(ถ้ามี)</span>
				</label>
				<Textarea
					id="ticket-notes"
					bind:value={notes}
					rows={3}
					placeholder="เช่น เบิกด่วนสำหรับผู้พักพิงกลุ่มเปราะบาง, ส่งมอบภายใน 12:00 น."
					class="min-h-20 w-full resize-y rounded-lg bg-white px-3 py-2.5 text-sm leading-relaxed shadow-2xs placeholder:text-slate-400"
				/>
			</div>
		</div>

		<!-- Footer Actions -->
		<div
			class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/75 px-6 py-4"
		>
			<div class="flex items-center gap-1.5 text-xs text-slate-500">
				<AlertCircle class="h-3.5 w-3.5 text-slate-400" />
				<span>เมื่อสร้างสำเร็จ ตั๋วจะอยู่ในสถานะ "รอจัดของ"</span>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						resetForm();
						open = false;
						onClose();
					}}
					class="text-xs font-semibold"
				>
					ยกเลิก
				</Button>

				<Button
					type="button"
					variant="default"
					onclick={handleSubmit}
					disabled={createMutation.isPending}
					class="text-xs font-semibold hover:bg-primary-dark"
				>
					{#if createMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" />
						<span>กำลังบันทึก...</span>
					{:else}
						<span>ยืนยันสร้างใบเบิกจ่าย</span>
					{/if}
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Catalog Item Picker Modal -->
<CatalogItemPicker
	bind:open={pickerOpen}
	{shelterCode}
	{requisitionType}
	alreadySelectedItemIds={selectedItems.map((i) => i.master._id)}
	onSelectItem={handleAddItem}
	onClose={() => (pickerOpen = false)}
/>
