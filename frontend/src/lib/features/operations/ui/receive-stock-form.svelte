<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ulid } from '$lib/db/ulid';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		keyableDonations,
		receiveInputSchema,
		type Donation,
		type ReceiveInput,
		type WalkInDonationInput
	} from '../domain/operations';
	import { storageLotFields, type StoragePointRef } from '../domain/lot-storage';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import StoragePointSelect from './storage-point-select.svelte';
	import { useSupplyItems } from '$lib/features/supply';
	import {
		itemMasterUnit,
		useItemMasters,
		formatUnit,
		useUnitsOfMeasure,
		itemSelectableUoms,
		defaultInventoryUom,
		toLedgerQtyUnit,
		type PackagingSource
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { sha256Hex } from '$lib/db/hash';
	import {
		useDonations,
		useReceiveStock,
		useReceiveWalkInDonation,
		useStockLedgers
	} from '../application/queries';
	import { toast } from 'svelte-sonner';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	export type MovementFormSuccess = { keepOpen: true; summary?: string };

	type StockFormItem = PackagingSource & {
		_id: string;
		name: string;
		unit: string;
		perishable?: boolean;
	};

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: (result?: MovementFormSuccess) => void; preselectedItemId?: string } = $props();

	// Fetch supply catalog items
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const receiveMutation = useReceiveStock();
	const donationsQuery = useDonations();
	const ledgersQuery = useStockLedgers();
	const walkInMutation = useReceiveWalkInDonation();

	let lastSuccess = $state<string | null>(null);
	let moreOpen = $state(false);
	let producedAtDate = $state('');
	let expiryDate = $state('');

	// Local state for searchable items combobox
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<StockFormItem | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	// Donation picker (CR-055 R4) — replaces the free-text `ref_id` box. Its own
	// container so the shared click-outside handler can close either dropdown.
	let donationSearch = $state('');
	let isDonationDropdownOpen = $state(false);
	let selectedDonation = $state<Donation | null>(null);
	let donationContainer = $state<HTMLDivElement | null>(null);

	// Walk-in capture (D-1). This only collects donor details — the donation doc
	// is minted at submit, alongside the ledger row, never before (see
	// `receiveWalkInDonation`).
	let isWalkInOpen = $state(false);
	let walkInDonorName = $state('');
	let walkInDonorPhone = $state('');

	const items = $derived.by((): StockFormItem[] => {
		const supplyItems = (itemsQuery.data ?? []).map((item) => ({
			_id: item._id,
			name: item.name,
			unit: item.unit,
			base_unit: item.unit,
			conversions: [] as { uom_name: string; multiplier: string }[],
			perishable: item.perishable
		}));
		const itemMasters = itemMastersQuery.data ?? [];

		const mappedItemMasters = itemMasters
			.filter((im) => !im.deactivated)
			.map((im) => ({
				_id: im._id,
				name: im.name,
				unit: itemMasterUnit(im),
				base_unit: itemMasterUnit(im),
				conversions: im.conversions ?? [],
				default_inventory_uom: im.default_inventory_uom,
				default_issue_uom: im.default_issue_uom,
				perishable: false
			}));

		return [...supplyItems, ...mappedItemMasters];
	});

	const unitOptions = $derived(selectedItem ? itemSelectableUoms(selectedItem) : []);

	// Filter items based on search query
	const filteredItems = $derived.by(() => {
		if (!searchQuery) return items;
		const query = searchQuery.toLowerCase().trim();
		return items.filter((i) => i.name.toLowerCase().includes(query));
	});

	const itemNameById = $derived(new Map(items.map((i) => [i._id, i.name])));

	/**
	 * Donations still owing stock. The picker exists so `ref_id` can only ever be
	 * a real donation `_id`: typing it by hand used to silently leave a donation
	 * reserved forever, or unreserve someone else's (CR-055 §Why).
	 */
	const openDonations = $derived(
		keyableDonations(donationsQuery.data ?? [], ledgersQuery.data ?? [])
	);

	const filteredDonations = $derived.by(() => {
		const query = donationSearch.toLowerCase().trim();
		if (!query) return openDonations;
		return openDonations.filter((d) => donationLabel(d).toLowerCase().includes(query));
	});

	function donationLabel(donation: Donation): string {
		const when = new Date(donation.declared_at).toLocaleDateString('th-TH', {
			day: '2-digit',
			month: 'short'
		});
		const goods = (donation.items ?? [])
			.map((i) => {
				const name = i.item_id ? (itemNameById.get(i.item_id) ?? i.item_id) : i.free_text;
				return `${name} ${i.qty} ${i.unit}`;
			})
			.join(', ');
		const ticket = donation.booking_ref ? ` (${donation.booking_ref})` : '';
		return [`${donation.donor.name}${ticket}`, when, goods].filter(Boolean).join(' · ');
	}

	const form = superForm(defaults({ source: 'manual' }, zod4(receiveInputSchema)), {
		SPA: true,
		validators: zod4(receiveInputSchema),
		resetForm: true,
		onUpdate: async ({ form: validated }) => {
			// In walk-in mode `ref_id` is legitimately empty: the donation does not
			// exist yet and is minted with the ledger row at submit. That is the one
			// error worth ignoring — `validated.valid` stays the authority for
			// everything else.
			const fields = Object.keys(validated.errors);
			const onlyWalkInRefId = isWalkIn && fields.length === 1 && fields[0] === 'ref_id';
			if (!validated.valid && !onlyWalkInRefId) {
				toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
				return;
			}

			// Validate perishable item expiry date requirement
			if (selectedItem?.perishable && !validated.data.lot?.expiry) {
				toast.error(`สินค้า "${selectedItem.name}" เป็นของเสียได้ จำเป็นต้องระบุวันหมดอายุ`);
				return;
			}

			if (isWalkIn) {
				const problem = walkInError();
				if (problem) {
					toast.error(problem);
					return;
				}
				await handleWalkInCommit(validated.data);
				return;
			}

			await handleCommit(validated.data);
		}
	});

	const { form: formData, submitting, reset } = form;

	const selectedUnitLabel = $derived(
		formatUnit($formData.unit, units, langState.current) || $formData.unit || 'เลือกหน่วย'
	);

	/**
	 * Whether this submit is a walk-in.
	 *
	 * Derived rather than read straight off `isWalkInOpen` so the mode cannot
	 * outlive the source that owns it: the panel is only rendered for `donation`,
	 * and a stale flag would otherwise send a Manual/Adjust receipt down the
	 * walk-in branch and fail it against the R2 guard with an error about a field
	 * that is not on screen.
	 */
	const isWalkIn = $derived($formData.source === 'donation' && isWalkInOpen);

	// Update locked unit when item is selected
	function selectItem(item: StockFormItem) {
		selectedItem = item;
		$formData.item_id = item._id;
		$formData.unit = defaultInventoryUom(item);
		searchQuery = item.name;
		isDropdownOpen = false;
	}

	/** Chosen storage point id ('' = unspecified / main store). */
	let storagePointId = $state('');

	// Location goes to `lot.storage_point_id` + `lot.storage_zone` (name snapshot),
	// never to `lot.note` (draft-shelter-storage-points).
	function setStoragePoint(point: StoragePointRef | null) {
		const lot = { ...($formData.lot ?? {}) };
		delete lot.storage_zone;
		delete lot.storage_point_id;
		$formData.lot = { ...lot, ...storageLotFields(point) };
	}

	// Keep expiryDate and $formData.lot.expiry in sync
	$effect(() => {
		const val = expiryDate.trim();
		if (!$formData.lot) {
			if (val) {
				$formData.lot = { expiry: val };
			}
		} else {
			const current = $formData.lot.expiry ?? '';
			if (current !== val) {
				$formData.lot.expiry = val || undefined;
			}
		}
	});

	// Keep producedAtDate and $formData.lot.produced_at in sync (empty → domain defaults to occurred_at)
	$effect(() => {
		const val = producedAtDate.trim();
		if (!$formData.lot) {
			if (val) {
				$formData.lot = { produced_at: val };
			}
		} else if (($formData.lot.produced_at ?? '') !== val) {
			$formData.lot.produced_at = val || undefined;
		}
	});

	function clearSelection() {
		selectedItem = null;
		$formData.item_id = '';
		$formData.unit = '';
		searchQuery = '';
		isDropdownOpen = false;
		clearDonation();
		expiryDate = '';
		producedAtDate = '';
		storagePointId = '';
		setStoragePoint(null);
	}

	/** After a successful save: clear qty/lot clocks; clear item unless row-panel pin. */
	function resetForNextLine() {
		$formData.qty = '' as unknown as typeof $formData.qty;
		expiryDate = '';
		producedAtDate = '';
		storagePointId = '';
		if ($formData.lot) {
			$formData.lot = {
				...$formData.lot,
				expiry: undefined,
				produced_at: undefined,
				storage_zone: undefined,
				storage_point_id: undefined
			};
		}
		setStoragePoint(null);
		clearDonation();
		resetWalkIn();
		if (!preselectedItemId) {
			clearSelection();
			reset({ data: { source: $formData.source || 'manual' } });
		}
	}

	function selectDonation(donation: Donation) {
		selectedDonation = donation;
		$formData.ref_id = donation._id;
		donationSearch = donationLabel(donation);
		isDonationDropdownOpen = false;
	}

	function clearDonation() {
		selectedDonation = null;
		$formData.ref_id = null;
		donationSearch = '';
		isDonationDropdownOpen = false;
	}

	// Quick expiry date buttons (+3d / +7d)
	function setQuickExpiry(days: number) {
		const formatted = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		expiryDate = formatted;
	}

	// Submit handler
	async function handleCommit(data: ReceiveInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};

		const packaging = selectedItem ?? { base_unit: data.unit, conversions: [] };
		const displayUnit = data.unit;
		const displayQty = data.qty;
		const ledger = toLedgerQtyUnit(data.qty, data.unit, packaging);
		const payload: ReceiveInput = { ...data, qty: ledger.qty, unit: ledger.unit };

		toast.promise(receiveMutation.mutateAsync({ input: payload, ctx }), {
			loading: 'กำลังบันทึก...',
			success: () => {
				const name = selectedItem?.name ?? data.item_id;
				const unitLabel = formatUnit(displayUnit, units, langState.current) || displayUnit;
				const summary = `${name} +${displayQty} ${unitLabel}`;
				lastSuccess = `รับเข้าแล้ว: ${summary}`;
				resetForNextLine();
				onsuccess?.({ keepOpen: true, summary });
				return 'รับเข้าแล้ว';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
		});
	}

	/** Walk-in receipt: donation doc + ledger row in one request. */
	async function handleWalkInCommit(data: ReceiveInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};
		const packaging = selectedItem ?? { base_unit: data.unit, conversions: [] };
		const displayUnit = data.unit;
		const displayQty = data.qty;
		const ledger = toLedgerQtyUnit(data.qty, data.unit, packaging);
		const payload: ReceiveInput = { ...data, qty: ledger.qty, unit: ledger.unit };
		const donation = await buildWalkInInput(payload);

		toast.promise(walkInMutation.mutateAsync({ donation, receive: payload, ctx }), {
			loading: 'กำลังบันทึก...',
			success: () => {
				const unitLabel = formatUnit(displayUnit, units, langState.current) || displayUnit;
				const summary = `${donation.donor.name} · ${selectedItem?.name ?? data.item_id} +${displayQty} ${unitLabel}`;
				lastSuccess = `รับเข้าแล้ว: ${summary}`;
				resetForNextLine();
				onsuccess?.({ keepOpen: true, summary });
				return 'รับเข้าแล้ว';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
		});
	}

	/**
	 * Keep the modal's locked item pinned to the form.
	 *
	 * More than a first-render pre-fill: a successful submit calls
	 * `clearSelection()`, and the combobox is `disabled` whenever
	 * `preselectedItemId` is set, so nothing could put the item back and every
	 * later submit in the same modal failed on an empty `item_id`/`unit` the user
	 * had no way to refill. Tracking `$formData.item_id` re-applies the pin after
	 * each reset — `useReceiveStock` only invalidates the operations keys, so
	 * `items` never changes identity to re-trigger the effect on its own.
	 */
	$effect(() => {
		if (!preselectedItemId || $formData.item_id === preselectedItemId) return;
		const item = items.find((i) => i._id === preselectedItemId);
		if (item) {
			selectItem(item);
		}
	});

	// Click outside a combobox closes its dropdown
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Node;
		if (container && !container.contains(target)) {
			isDropdownOpen = false;
		}
		if (donationContainer && !donationContainer.contains(target)) {
			isDonationDropdownOpen = false;
		}
	}

	/**
	 * Validate the walk-in donor fields without writing anything.
	 *
	 * The donation document is minted at submit, in the same request as the
	 * ledger row (`receiveWalkInDonation`). Writing it here on a button press
	 * would leave a `declared` donation behind whenever the receipt never
	 * followed, and `calculateReserved` counts those as reserved stock forever —
	 * nothing calls `expireDonation`.
	 */
	function walkInError(): string | null {
		if (!walkInDonorName.trim()) return 'ระบุชื่อผู้บริจาค';
		const phone = walkInDonorPhone.trim();
		if (phone && !/^[0-9]+$/.test(phone)) return 'เบอร์โทรต้องเป็นตัวเลขเท่านั้น';
		return null;
	}

	/**
	 * `phone_hash` is what links a donor's donations together once retention
	 * drops the raw phone. With no phone there is nothing to link, so a
	 * per-donation nonce fills the required field without inventing a linkage.
	 */
	async function buildWalkInInput(data: ReceiveInput): Promise<WalkInDonationInput> {
		const phone = walkInDonorPhone.trim() || null;
		const [phoneHash, trackingTokenHash] = await Promise.all([
			sha256Hex(phone ?? ulid()),
			sha256Hex(ulid())
		]);
		return {
			donor: { name: walkInDonorName.trim(), phone, phone_hash: phoneHash },
			kind: 'items',
			items: [{ item_id: data.item_id, qty: data.qty, unit: data.unit }],
			campaign_id: null,
			tracking_token_hash: trackingTokenHash
		};
	}

	function resetWalkIn() {
		isWalkInOpen = false;
		walkInDonorName = '';
		walkInDonorPhone = '';
	}
</script>

<svelte:document onclick={handleClickOutside} />

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-md sm:p-5"
>
	<div class="flex items-center gap-2 border-b border-border/60 pb-3">
		<PackagePlus class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
		<h3 class="text-sm font-bold text-foreground">รับเข้า</h3>
	</div>

	{#if lastSuccess}
		<p
			class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
			role="status"
		>
			{lastSuccess} ✓
		</p>
	{/if}

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สินค้า <span class="font-bold text-destructive">*</span></Form.Label>
					<div bind:this={container} class="relative w-full">
						<Input
							{...props}
							placeholder="ค้นหา…"
							bind:value={searchQuery}
							onfocus={() => !preselectedItemId && (isDropdownOpen = true)}
							oninput={() => !preselectedItemId && (isDropdownOpen = true)}
							role="combobox"
							aria-expanded={isDropdownOpen}
							aria-controls="item-listbox"
							aria-haspopup="listbox"
							autocomplete="off"
							disabled={!!preselectedItemId}
							class="min-h-11 {preselectedItemId
								? 'cursor-not-allowed bg-muted font-bold text-muted-foreground'
								: ''}"
						/>
						{#if selectedItem && !preselectedItemId}
							<Button
								type="button"
								variant="ghost"
								class="absolute top-1/2 right-1 min-h-11 min-w-11 -translate-y-1/2 px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
								onclick={clearSelection}
							>
								ล้าง
							</Button>
						{/if}

						{#if isDropdownOpen}
							<div
								id="item-listbox"
								role="listbox"
								class="absolute left-0 z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
							>
								{#if itemsQuery.isLoading || itemMastersQuery.isLoading}
									<div class="p-3 text-xs text-muted-foreground">กำลังโหลด…</div>
								{:else if filteredItems.length === 0}
									<div class="p-3 text-xs text-muted-foreground">ไม่พบสินค้า</div>
								{:else}
									{#each filteredItems as item (item._id)}
										<button
											type="button"
											role="option"
											aria-selected={selectedItem?._id === item._id}
											class="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted"
											onclick={() => selectItem(item)}
										>
											<span class="font-semibold text-foreground">{item.name}</span>
											<span
												class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
											>
												{formatUnit(item.unit, units, langState.current)}
											</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จำนวน <span class="font-bold text-destructive">*</span></Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="0"
						min="0.01"
						step="any"
						bind:value={$formData.qty}
						class="min-h-11 font-mono font-bold"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หน่วย <span class="font-bold text-destructive">*</span></Form.Label>
					{#if !selectedItem}
						<Input
							{...props}
							placeholder="เลือกสินค้าก่อน"
							value=""
							readonly
							disabled
							class="min-h-11"
						/>
					{:else if unitOptions.length <= 1}
						<Input {...props} value={selectedUnitLabel} readonly disabled class="min-h-11" />
					{:else}
						<Select.Root
							type="single"
							value={$formData.unit}
							onValueChange={(val) => {
								if (val) $formData.unit = val;
							}}
						>
							<Select.Trigger
								{...props}
								class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium"
							>
								{selectedUnitLabel}
							</Select.Trigger>
							<Select.Content>
								{#each unitOptions as option (option.code)}
									<Select.Item
										value={option.code}
										label={formatUnit(option.code, units, langState.current) || option.code}
									/>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="lot.produced_at" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>วันผลิต</Form.Label>
					<DatePicker {...props} bind:value={producedAtDate} placeholder="วันนี้ = เข้าคลัง" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Storage Location (lot.storage_point_id + lot.storage_zone) -->
		<Form.Field {form} name="lot.storage_zone" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานที่จัดเก็บ (จุดเก็บของของศูนย์)</Form.Label>
					<StoragePointSelect
						points={storagePoints.points}
						bind:value={storagePointId}
						onchange={setStoragePoint}
						triggerProps={props}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="lot.expiry" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
						<Form.Label>
							วันหมดอายุ
							{#if selectedItem?.perishable}
								<span class="font-bold text-destructive">*</span>
							{:else}
								<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
							{/if}
						</Form.Label>
						<div class="flex gap-2">
							<Button
								type="button"
								variant="outline"
								class="min-h-11 min-w-[48px] rounded-lg px-3 text-xs font-bold"
								onclick={() => setQuickExpiry(3)}
							>
								+3 วัน
							</Button>
							<Button
								type="button"
								variant="outline"
								class="min-h-11 min-w-[48px] rounded-lg px-3 text-xs font-bold"
								onclick={() => setQuickExpiry(7)}
							>
								+7 วัน
							</Button>
						</div>
					</div>
					<DatePicker {...props} bind:value={expiryDate} placeholder="วว/ดด/ปปปป" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="col-span-1 sm:col-span-2">
			<button
				type="button"
				class="flex min-h-11 w-full items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 text-sm font-semibold text-foreground"
				onclick={() => (moreOpen = !moreOpen)}
				aria-expanded={moreOpen}
			>
				<span>เพิ่มเติม</span>
				<ChevronDown
					class="h-4 w-4 transition-transform {moreOpen ? 'rotate-180' : ''}"
					aria-hidden="true"
				/>
			</button>

			{#if moreOpen}
				<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Form.Field {form} name="source" class="col-span-1 sm:col-span-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ที่มา <span class="font-bold text-destructive">*</span></Form.Label>
								<Select.Root
									type="single"
									bind:value={$formData.source}
									onValueChange={(val) => {
										if (val && val !== 'donation') {
											clearDonation();
											resetWalkIn();
										}
									}}
								>
									<Select.Trigger
										{...props}
										class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium"
									>
										{$formData.source === 'manual' ? 'รับเข้าคลัง' : 'บริจาค'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="donation" label="บริจาค" />
										<Select.Item value="manual" label="รับเข้าคลัง" />
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					{#if $formData.source === 'donation' && !isWalkIn}
						<Form.Field {form} name="ref_id" class="relative col-span-1 sm:col-span-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label
										>อ้างอิงบริจาค <span class="font-bold text-destructive">*</span></Form.Label
									>
									<div bind:this={donationContainer} class="relative w-full">
										<Input
											{...props}
											placeholder="ค้นหาใบบริจาค…"
											bind:value={donationSearch}
											onfocus={() => (isDonationDropdownOpen = true)}
											oninput={() => {
												isDonationDropdownOpen = true;
												if (selectedDonation) {
													selectedDonation = null;
													$formData.ref_id = null;
												}
											}}
											role="combobox"
											aria-expanded={isDonationDropdownOpen}
											aria-controls="donation-listbox"
											aria-haspopup="listbox"
											autocomplete="off"
											class="min-h-11"
										/>
										{#if selectedDonation}
											<Button
												type="button"
												variant="ghost"
												size="xs"
												class="absolute top-1/2 right-2 -translate-y-1/2"
												onclick={clearDonation}
											>
												ล้าง
											</Button>
										{/if}

										{#if isDonationDropdownOpen}
											<div
												id="donation-listbox"
												role="listbox"
												class="absolute left-0 z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
											>
												{#if donationsQuery.isLoading || ledgersQuery.isLoading}
													<div class="p-3 text-xs text-muted-foreground">กำลังโหลด…</div>
												{:else if filteredDonations.length === 0}
													<div class="p-3 text-xs text-muted-foreground">
														ไม่มีใบบริจาครอรับ — ใช้บริจาคหน้างานด้านล่าง
													</div>
												{:else}
													{#each filteredDonations as donation (donation._id)}
														<button
															type="button"
															role="option"
															aria-selected={selectedDonation?._id === donation._id}
															class="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left hover:bg-muted"
															onclick={() => selectDonation(donation)}
														>
															<span class="text-sm font-semibold text-foreground">
																{donation.donor.name}
															</span>
															<span class="text-xs text-muted-foreground"
																>{donationLabel(donation)}</span
															>
														</button>
													{/each}
												{/if}
											</div>
										{/if}
									</div>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					{/if}

					{#if $formData.source === 'donation'}
						<div class="col-span-1 sm:col-span-2">
							{#if isWalkInOpen}
								<div
									class="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4"
								>
									<div class="flex items-center justify-between">
										<span class="text-xs font-bold text-foreground">บริจาคหน้างาน</span>
										<Button
											type="button"
											variant="ghost"
											class="min-h-11 px-4 text-sm font-semibold"
											onclick={resetWalkIn}
										>
											เลือกจากใบแทน
										</Button>
									</div>
									<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
										<div>
											<Label for="walkin-donor-name" class="mb-1.5 block text-xs font-medium">
												ชื่อผู้บริจาค <span class="font-bold text-destructive">*</span>
											</Label>
											<Input
												id="walkin-donor-name"
												placeholder="ชื่อ"
												bind:value={walkInDonorName}
												class="min-h-11"
											/>
										</div>
										<div>
											<Label for="walkin-donor-phone" class="mb-1.5 block text-xs font-medium">
												เบอร์โทร
											</Label>
											<Input
												id="walkin-donor-phone"
												placeholder="ไม่บังคับ"
												inputmode="numeric"
												bind:value={walkInDonorPhone}
												class="min-h-11"
											/>
										</div>
									</div>
								</div>
							{:else}
								<Button
									type="button"
									variant="link"
									size="sm"
									class="h-auto p-0 text-xs font-bold"
									onclick={() => {
										clearDonation();
										isWalkInOpen = true;
									}}
								>
									ไม่มีใบจอง? บริจาคหน้างาน
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="col-span-1 pt-1 sm:col-span-2">
			<Form.Button size="lg" disabled={$submitting} class="min-h-11 w-full font-bold">
				{$submitting ? 'กำลังบันทึก…' : 'บันทึกแล้วรับชิ้นถัดไป'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
