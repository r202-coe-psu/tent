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
	import ItemCombobox from './item-combobox.svelte';
	import DonationBatchReceive from './donation-batch-receive.svelte';
	import {
		formatUnit,
		useUnitsOfMeasure,
		itemSelectableUoms,
		defaultInventoryUom,
		toLedgerQtyUnit,
		shelfLifeExpiryLabel
	} from '$lib/features/catalog';
	import {
		applyExpiryAutofill,
		confirmExpiry,
		editExpiry,
		expiryMissing,
		initialExpiryState,
		todayLocalIso,
		type ExpiryState
	} from '../domain/lot-expiry';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { sha256Hex } from '$lib/db/hash';
	import {
		useDonations,
		useReceiveStock,
		useReceiveWalkInDonation,
		useStockBalance,
		useStockLedgers
	} from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import { toast } from 'svelte-sonner';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import HandHelping from '@lucide/svelte/icons/hand-helping';
	import Package from '@lucide/svelte/icons/package';
	import { SvelteDate } from 'svelte/reactivity';
	import { tick } from 'svelte';

	export type MovementFormSuccess = { keepOpen: boolean; summary?: string };

	/** UI-only source cards — still maps to `source: 'donation' | 'manual'`. */
	type SourceMode = 'donation_ticket' | 'walk_in' | 'manual';

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: (result?: MovementFormSuccess) => void; preselectedItemId?: string } = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	const stockItems = useStockFormItems(() => getShelterCode());
	const balanceQuery = useStockBalance();
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const receiveMutation = useReceiveStock();
	const donationsQuery = useDonations();
	const ledgersQuery = useStockLedgers();
	const walkInMutation = useReceiveWalkInDonation();

	let moreOpen = $state(false);
	let producedAtDate = $state('');
	// `lot.expiry` field state (CR-143 §D): autofilled from the item's shelf life until the
	// user edits or confirms it. `expiry.autoFilled` is UI-only and never reaches the ledger.
	let expiry = $state<ExpiryState>(initialExpiryState());
	let expiryAttempted = $state(false);
	let sourceMode = $state<SourceMode>('manual');

	let selectedItemId = $state('');
	let selectedItem = $state<StockFormItem | null>(null);

	// Set when the item was just created from the picker: shows the "ใหม่" badge and moves
	// focus to the quantity field so the user can keep typing.
	let justCreatedItemId = $state('');
	let qtyInput = $state<HTMLInputElement | null>(null);

	async function focusQty() {
		await tick();
		qtyInput?.focus();
	}

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

	const items = $derived(stockItems.items);
	const unitOptions = $derived(selectedItem ? itemSelectableUoms(selectedItem) : []);
	const itemNameById = $derived(new Map(items.map((i) => [i._id, i.name])));
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());

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

	function sourceCardClass(active: boolean) {
		return [
			'flex min-h-11 w-full flex-col items-start gap-1 rounded-xl border-2 px-3 py-3 text-left transition-colors',
			active
				? 'border-[#0284C7] bg-sky-50 text-sky-950'
				: 'border-border bg-card text-foreground hover:border-slate-400'
		].join(' ');
	}

	function setSourceMode(mode: SourceMode) {
		sourceMode = mode;
		if (mode === 'manual') {
			$formData.source = 'manual';
			clearDonation();
			resetWalkIn();
			return;
		}
		$formData.source = 'donation';
		if (mode === 'donation_ticket') {
			resetWalkIn();
			return;
		}
		clearDonation();
		isWalkInOpen = true;
	}

	const form = superForm(defaults({ source: 'manual' }, zod4(receiveInputSchema)), {
		SPA: true,
		validators: zod4(receiveInputSchema),
		resetForm: true,
		onUpdate: async ({ form: validated, cancel }) => {
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

			// FR-D2: an item that requires an expiry cannot be saved without one.
			if (selectedItem?.requiresExpiry && !validated.data.lot?.expiry) {
				expiryAttempted = true;
				// Without cancel() superforms resets the (valid) form, wiping item and qty.
				cancel();
				toast.error(`สินค้า "${selectedItem.name}" ต้องระบุวันหมดอายุ`);
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

	// With a donation ticket the lines are counted and received together (CR-143 §B) by
	// `DonationBatchReceive`, which replaces the one-item fields below.
	function handleBatchReceived(summary: string) {
		clearDonation();
		onsuccess?.({ keepOpen: true, summary });
	}

	// Update locked unit when item is selected
	function selectItem(item: StockFormItem) {
		// A date keyed or confirmed for another item says nothing about this one (FR-D2c).
		if (selectedItemId && selectedItemId !== item._id) commitExpiry(initialExpiryState());
		selectedItem = item;
		selectedItemId = item._id;
		$formData.item_id = item._id;
		$formData.unit = defaultInventoryUom(item);
		refreshExpiryAutofill();
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

	/** Mirror the expiry state into `lot.expiry` (the only expiry field that is persisted). */
	function writeLotExpiry(value: string) {
		if (!$formData.lot) {
			if (value) $formData.lot = { expiry: value };
			return;
		}
		if (($formData.lot.expiry ?? '') !== value) {
			$formData.lot.expiry = value || undefined;
		}
	}

	function commitExpiry(next: ExpiryState) {
		expiry = next;
		writeLotExpiry(next.value);
		if (next.value) expiryAttempted = false;
	}

	/** The user typed, picked or cleared the date. */
	function setExpiryDate(val: string) {
		commitExpiry(editExpiry(expiry, val));
	}

	/** Recompute from the item's shelf life unless the user has taken over (FR-D2a). */
	function refreshExpiryAutofill() {
		commitExpiry(applyExpiryAutofill(expiry, selectedItem, producedAtDate, todayLocalIso()));
	}

	/** Empty → domain defaults produced_at to occurred_at. */
	function setProducedAtDate(val: string) {
		producedAtDate = val;
		const trimmed = val.trim();
		if (!$formData.lot) {
			if (trimmed) $formData.lot = { produced_at: trimmed };
		} else if (($formData.lot.produced_at ?? '') !== trimmed) {
			$formData.lot.produced_at = trimmed || undefined;
		}
		refreshExpiryAutofill();
	}

	function clearSelection() {
		selectedItem = null;
		selectedItemId = '';
		justCreatedItemId = '';
		$formData.item_id = '';
		$formData.unit = '';
		clearDonation();
		commitExpiry(initialExpiryState());
		expiryAttempted = false;
		setProducedAtDate('');
		storagePointId = '';
		setStoragePoint(null);
	}

	/** After a successful save: clear qty/lot clocks; clear item unless row-panel pin. */
	function resetForNextLine() {
		$formData.qty = '' as unknown as typeof $formData.qty;
		commitExpiry(initialExpiryState());
		expiryAttempted = false;
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
		if (sourceMode === 'walk_in') {
			isWalkInOpen = true;
		}
		if (!preselectedItemId) {
			clearSelection();
			reset({ data: { source: $formData.source || 'manual' } });
		} else {
			// The pinned item stays: its next lot gets a fresh autofill.
			refreshExpiryAutofill();
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

	/** Quick expiry shortcuts: +7ว / +6ด / +1ปี */
	function setQuickExpiry(offset: { days?: number; months?: number; years?: number }) {
		const d = new SvelteDate();
		if (offset.years) d.setFullYear(d.getFullYear() + offset.years);
		if (offset.months) d.setMonth(d.getMonth() + offset.months);
		if (offset.days) d.setDate(d.getDate() + offset.days);
		setExpiryDate(d.toISOString().split('T')[0] ?? '');
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

	// Click outside donation picker closes its dropdown
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Node;
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

<form method="POST" use:form.enhance class="flex flex-col space-y-4">
	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<div class="col-span-1 space-y-2 sm:col-span-2">
			<p class="text-sm font-bold text-foreground">1 · ของมาจากไหน</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="ที่มา">
				<button
					type="button"
					role="radio"
					aria-checked={sourceMode === 'donation_ticket'}
					class={sourceCardClass(sourceMode === 'donation_ticket')}
					onclick={() => setSourceMode('donation_ticket')}
				>
					<span class="flex items-center gap-2 text-sm font-bold">
						<ClipboardList class="h-4 w-4 shrink-0" aria-hidden="true" />
						ใบบริจาค
					</span>
					<span class="text-xs font-medium text-muted-foreground">
						{#if openDonations.length > 0}
							รอรับ {openDonations.length} ใบ
						{:else}
							เลือกจากใบจอง
						{/if}
					</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={sourceMode === 'walk_in'}
					class={sourceCardClass(sourceMode === 'walk_in')}
					onclick={() => setSourceMode('walk_in')}
				>
					<span class="flex items-center gap-2 text-sm font-bold">
						<HandHelping class="h-4 w-4 shrink-0" aria-hidden="true" />
						บริจาคหน้างาน
					</span>
					<span class="text-xs font-medium text-muted-foreground">ระบุชื่อผู้บริจาค</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={sourceMode === 'manual'}
					class={sourceCardClass(sourceMode === 'manual')}
					onclick={() => setSourceMode('manual')}
				>
					<span class="flex items-center gap-2 text-sm font-bold">
						<Package class="h-4 w-4 shrink-0" aria-hidden="true" />
						รับเข้าอื่นๆ
					</span>
					<span class="text-xs font-medium text-muted-foreground">รับเข้าคลังทั่วไป</span>
				</button>
			</div>
		</div>

		{#if sourceMode === 'donation_ticket'}
			<Form.Field {form} name="ref_id" class="relative col-span-1 sm:col-span-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>อ้างอิงบริจาค <span class="font-bold text-destructive">*</span></Form.Label>
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
											ไม่มีใบบริจาครอรับ — ลองบริจาคหน้างาน
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
												<span class="text-xs text-muted-foreground">{donationLabel(donation)}</span>
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

		{#if sourceMode === 'walk_in'}
			<div
				class="col-span-1 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4 sm:col-span-2"
			>
				<span class="text-xs font-bold text-foreground">บริจาคหน้างาน</span>
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
		{/if}

		{#if sourceMode === 'donation_ticket'}
			{#if selectedDonation}
				<!-- keyed by donation so picking another ticket starts a fresh count -->
				{#key selectedDonation._id}
					<DonationBatchReceive donation={selectedDonation} onsuccess={handleBatchReceived} />
				{/key}
			{:else}
				<p class="col-span-1 text-sm text-slate-500 sm:col-span-2">
					เลือกใบบริจาคเพื่อดึงรายการทั้งหมดมานับรับของพร้อมกัน
				</p>
			{/if}
		{:else}
			<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							สินค้า <span class="font-bold text-destructive">*</span>
							{#if justCreatedItemId && justCreatedItemId === selectedItemId}
								<span class="ml-2 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-bold text-white"
									>ใหม่</span
								>
							{/if}
						</Form.Label>
						<ItemCombobox
							id={props.id}
							name={props.name}
							aria-invalid={props['aria-invalid']}
							aria-describedby={props['aria-describedby']}
							{items}
							allowCreate
							bind:value={selectedItemId}
							disabled={!!preselectedItemId}
							isLoading={stockItems.isLoading}
							{balanceByItemId}
							formatBalanceUnit={(item) =>
								formatUnit(item.unit, units, langState.current) || item.unit}
							onSelect={(item, meta) => {
								if (!item) {
									clearSelection();
									return;
								}
								selectItem(item);
								// A scanned pack barcode names the unit it was printed on.
								if (meta?.uom) $formData.unit = meta.uom;
								if (meta?.created) {
									justCreatedItemId = item._id;
									void focusQty();
								}
							}}
						/>
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
							bind:ref={qtyInput}
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
								{#if selectedItem?.requiresExpiry}
									<span class="font-bold text-destructive">*</span>
								{:else}
									<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
								{/if}
							</Form.Label>
							<div class="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									class="min-h-11 min-w-[48px] rounded-lg px-3 text-xs font-bold"
									onclick={() => setQuickExpiry({ days: 7 })}
								>
									+7ว
								</Button>
								<Button
									type="button"
									variant="outline"
									class="min-h-11 min-w-[48px] rounded-lg px-3 text-xs font-bold"
									onclick={() => setQuickExpiry({ months: 6 })}
								>
									+6ด
								</Button>
								<Button
									type="button"
									variant="outline"
									class="min-h-11 min-w-[48px] rounded-lg px-3 text-xs font-bold"
									onclick={() => setQuickExpiry({ years: 1 })}
								>
									+1ปี
								</Button>
							</div>
						</div>
						<DatePicker
							{...props}
							bind:value={() => expiry.value, setExpiryDate}
							placeholder="วว/ดด/ปปปป"
						/>
						{#if expiry.autoFilled && expiry.shelfLifeDays != null}
							<div
								class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
							>
								<span>{shelfLifeExpiryLabel(expiry.shelfLifeDays)}</span>
								<Button
									type="button"
									variant="outline"
									class="min-h-11 rounded-lg px-3 text-xs font-bold"
									onclick={() => commitExpiry(confirmExpiry(expiry))}
								>
									ตรวจสอบแล้ว
								</Button>
							</div>
						{/if}
						{#if expiryAttempted && expiryMissing(selectedItem, expiry)}
							<p class="mt-2 text-sm font-semibold text-destructive" role="alert">
								สินค้านี้ต้องระบุวันหมดอายุ
							</p>
						{/if}
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
					<span>ตัวเลือกเพิ่มเติม</span>
					<ChevronDown
						class="h-4 w-4 transition-transform {moreOpen ? 'rotate-180' : ''}"
						aria-hidden="true"
					/>
				</button>

				{#if moreOpen}
					<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field {form} name="lot.produced_at" class="col-span-1 sm:col-span-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>วันผลิต</Form.Label>
									<DatePicker
										{...props}
										bind:value={() => producedAtDate, setProducedAtDate}
										placeholder="วันนี้ = เข้าคลัง"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>
				{/if}
			</div>

			<div
				class="sticky bottom-0 z-10 col-span-1 -mx-4 -mb-4 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:col-span-2 sm:-mx-6 sm:-mb-6 sm:px-6"
			>
				<Form.Button size="lg" disabled={$submitting || offline} class="min-h-11 w-full font-bold">
					{$submitting ? 'กำลังบันทึก…' : 'บันทึกแล้วรับชิ้นถัดไป'}
				</Form.Button>
			</div>
		{/if}
	</Field.FieldGroup>
</form>
