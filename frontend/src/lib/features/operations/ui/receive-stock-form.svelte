<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		keyableDonations,
		receiveInputSchema,
		type Donation,
		type ReceiveInput,
		type WalkInDonationInput
	} from '../domain/operations';
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters } from '$lib/features/catalog';
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

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: () => void; preselectedItemId?: string } = $props();

	// Fetch supply catalog items
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters();
	const receiveMutation = useReceiveStock();
	const donationsQuery = useDonations();
	const ledgersQuery = useStockLedgers();
	const walkInMutation = useReceiveWalkInDonation();

	// Local state for searchable items combobox
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<{
		_id: string;
		name: string;
		unit: string;
		perishable?: boolean;
	} | null>(null);
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

	const items = $derived.by(() => {
		const supplyItems = itemsQuery.data ?? [];
		const itemMasters = itemMastersQuery.data ?? [];

		const mappedItemMasters = itemMasters.map((im) => ({
			_id: im._id,
			name: im.name,
			category: im.category || 'other',
			unit: itemMasterUnit(im),
			reorder_level: null,
			perishable: false
		}));

		return [...supplyItems, ...mappedItemMasters];
	});

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

	const form = superForm(defaults({ source: 'donation' }, zod4(receiveInputSchema)), {
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
	function selectItem(item: { _id: string; name: string; unit: string; perishable?: boolean }) {
		selectedItem = item;
		$formData.item_id = item._id;
		$formData.unit = item.unit;
		searchQuery = item.name;
		isDropdownOpen = false;
	}

	function clearSelection() {
		selectedItem = null;
		$formData.item_id = '';
		$formData.unit = '';
		searchQuery = '';
		isDropdownOpen = false;
		clearDonation();
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

	/**
	 * Drop the donation when the source stops being a donation.
	 *
	 * The picker is hidden for `manual`, but hiding a field does not empty it:
	 * a leftover `ref_id` maps to `reason: 'adjust'`, which R2 requires to be
	 * null, so the submit would fail against a field the user can no longer see.
	 * The schema rejects the stale value — it cannot clear it, so the form must.
	 */
	function handleSourceChange(e: Event & { currentTarget: HTMLSelectElement }) {
		if (e.currentTarget.value !== 'donation') {
			clearDonation();
			resetWalkIn();
		}
	}

	// Quick expiry date buttons (+3d / +7d)
	function setQuickExpiry(days: number) {
		const formatted = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		if (!$formData.lot) {
			$formData.lot = { expiry: formatted, note: '' };
		} else {
			$formData.lot.expiry = formatted;
		}
	}

	// Submit handler
	async function handleCommit(data: ReceiveInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};

		toast.promise(receiveMutation.mutateAsync({ input: data, ctx }), {
			loading: 'กำลังบันทึกข้อมูล...',
			success: () => {
				clearSelection();
				reset();
				if (onsuccess) onsuccess();
				return 'บันทึกของเข้าคลังสำเร็จ!';
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
		const donation = await buildWalkInInput(data);

		toast.promise(walkInMutation.mutateAsync({ donation, receive: data, ctx }), {
			loading: 'กำลังบันทึกข้อมูล...',
			success: () => {
				clearSelection();
				resetWalkIn();
				reset();
				if (onsuccess) onsuccess();
				return `บันทึกของบริจาคหน้างานของ "${donation.donor.name}" สำเร็จ!`;
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
			sha256Hex(phone ?? crypto.randomUUID()),
			sha256Hex(crypto.randomUUID())
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
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-2 flex items-center gap-2 border-b border-border/60 pb-3">
		<PackagePlus class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">รับของเข้าคลัง (Inbound Stock Receipt)</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Searchable Item Selector -->
		<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground"
						>ค้นหาและเลือกรายการสิ่งของ</Form.Label
					>
					<div bind:this={container} class="relative w-full">
						<Input
							{...props}
							placeholder="พิมพ์เพื่อค้นหา เช่น ข้าวสาร, น้ำดื่ม..."
							bind:value={searchQuery}
							onfocus={() => !preselectedItemId && (isDropdownOpen = true)}
							oninput={() => !preselectedItemId && (isDropdownOpen = true)}
							role="combobox"
							aria-expanded={isDropdownOpen}
							aria-controls="item-listbox"
							aria-haspopup="listbox"
							autocomplete="off"
							disabled={!!preselectedItemId}
							class={[
								'h-10 w-full rounded-xl border border-border/80 bg-background px-3 shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20',
								preselectedItemId
									? 'cursor-not-allowed bg-muted font-bold text-muted-foreground'
									: ''
							]}
						/>
						{#if selectedItem && !preselectedItemId}
							<button
								type="button"
								class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
								onclick={clearSelection}
							>
								ล้างค่า
							</button>
						{/if}

						{#if isDropdownOpen}
							<div
								id="item-listbox"
								role="listbox"
								class="absolute left-0 z-20 mt-1 max-h-60 w-full animate-in overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl duration-150 fade-in slide-in-from-top-1"
							>
								{#if itemsQuery.isLoading || itemMastersQuery.isLoading}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										กำลังโหลดรายการสิ่งของ...
									</div>
								{:else if filteredItems.length === 0}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										ไม่พบรายการสิ่งของ
									</div>
								{:else}
									{#each filteredItems as item (item._id)}
										<button
											type="button"
											role="option"
											aria-selected={selectedItem?._id === item._id}
											class="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
											onclick={() => selectItem(item)}
										>
											<span class="font-semibold text-foreground">{item.name}</span>
											<span
												class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
											>
												หน่วย: {item.unit}
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

		<!-- Quantity -->
		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">จำนวนที่รับเข้า</Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="ระบุจำนวน"
						min="0.01"
						step="any"
						bind:value={$formData.qty}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 font-mono text-sm font-bold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Unit (Locked) -->
		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">หน่วยนับ</Form.Label>
					<Input
						{...props}
						placeholder="ระบบจะล็อกอัตโนมัติ"
						bind:value={$formData.unit}
						readonly
						class="h-10 w-full cursor-not-allowed rounded-xl border border-border/80 bg-muted px-3 font-semibold text-muted-foreground shadow-sm"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Source -->
		<Form.Field {form} name="source" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">แหล่งที่มา</Form.Label>
					<!--
						`transfer_in` stays in `receiveSourceSchema` and `ledgerReasonSchema`
						but is deliberately absent here (CR-055 D-3): R2 requires a
						`stock_transfer:` ref_id and nothing mints those docs until T-13
						lands, so offering the option would only produce submissions that
						can never validate.
					-->
					<select
						{...props}
						bind:value={$formData.source}
						onchange={handleSourceChange}
						class="h-10 w-full cursor-pointer rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
					>
						<option value="donation">ของบริจาค (Donation)</option>
						<option value="manual">กรอกปรับปรุงคลังด้วยตนเอง (Manual/Adjust)</option>
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Donation picker (CR-055 R4) — only `donation` carries a ref_id here -->
		{#if $formData.source === 'donation' && !isWalkIn}
			<Form.Field {form} name="ref_id" class="relative col-span-1 sm:col-span-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-xs font-bold text-foreground">ใบบริจาคที่รับของเข้า</Form.Label>
						<div bind:this={donationContainer} class="relative w-full">
							<Input
								{...props}
								placeholder="ค้นหาใบบริจาค เช่น ชื่อผู้บริจาค, เลขที่ตั๋ว..."
								bind:value={donationSearch}
								onfocus={() => (isDonationDropdownOpen = true)}
								oninput={() => {
									isDonationDropdownOpen = true;
									// typing after a pick invalidates it — never leave a stale
									// ref_id pointing at a donation the label no longer shows
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
								class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
							/>
							{#if selectedDonation}
								<button
									type="button"
									class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
									onclick={clearDonation}
								>
									ล้างค่า
								</button>
							{/if}

							{#if isDonationDropdownOpen}
								<div
									id="donation-listbox"
									role="listbox"
									class="absolute left-0 z-20 mt-1 max-h-60 w-full animate-in overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl duration-150 fade-in slide-in-from-top-1"
								>
									{#if donationsQuery.isLoading || ledgersQuery.isLoading}
										<div class="p-3 text-xs font-medium text-muted-foreground">
											กำลังโหลดใบบริจาค...
										</div>
									{:else if filteredDonations.length === 0}
										<div class="p-3 text-xs font-medium text-muted-foreground">
											ไม่มีใบบริจาคที่ยังรอรับของ — ใช้ปุ่ม "บันทึกบริจาคหน้างาน" ด้านล่าง
										</div>
									{:else}
										{#each filteredDonations as donation (donation._id)}
											<button
												type="button"
												role="option"
												aria-selected={selectedDonation?._id === donation._id}
												class="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
												onclick={() => selectDonation(donation)}
											>
												<span class="text-sm font-semibold text-foreground">
													{donation.donor.name}
													{#if donation.booking_ref}
														<span class="font-mono text-xs text-muted-foreground"
															>({donation.booking_ref})</span
														>
													{/if}
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

		<!-- Walk-in donation (CR-055 D-1) — goods that arrive without a booking.
			 Only captures the donor here; the donation doc is minted with the
			 ledger row on submit, so an abandoned form writes nothing. -->
		{#if $formData.source === 'donation'}
			<div class="col-span-1 sm:col-span-2">
				{#if isWalkInOpen}
					<div
						class="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4"
					>
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold text-foreground">บริจาคหน้างาน (Walk-in)</span>
							<button
								type="button"
								class="text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
								onclick={resetWalkIn}
							>
								เลือกจากใบบริจาคแทน
							</button>
						</div>
						<p class="text-xs text-muted-foreground">
							ระบบจะสร้างใบบริจาคจากรายการด้านบนพร้อมกับบันทึกของเข้าคลังในขั้นตอนเดียว
						</p>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Input
								placeholder="ชื่อผู้บริจาค *"
								bind:value={walkInDonorName}
								class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm"
							/>
							<Input
								placeholder="เบอร์โทร (ไม่บังคับ)"
								inputmode="numeric"
								bind:value={walkInDonorPhone}
								class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm"
							/>
						</div>
					</div>
				{:else}
					<button
						type="button"
						class="cursor-pointer text-xs font-bold text-primary underline-offset-2 transition hover:underline"
						onclick={() => {
							clearDonation();
							isWalkInOpen = true;
						}}
					>
						ไม่มีใบจอง? บันทึกบริจาคหน้างาน
					</button>
				{/if}
			</div>
		{/if}

		<!-- Storage Location (lot.note) -->
		<Form.Field {form} name="lot.note" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground"
						>สถานที่จัดเก็บในคลัง (โซน/ชั้นวาง)</Form.Label
					>
					<select
						{...props}
						value={$formData.lot?.note ?? ''}
						onchange={(e) => {
							if (!$formData.lot) {
								$formData.lot = { expiry: '', note: e.currentTarget.value };
							} else {
								$formData.lot.note = e.currentTarget.value;
							}
						}}
						class="h-10 w-full cursor-pointer rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
					>
						<option value="">เลือกโซนที่เก็บ</option>
						<option value="Zone A">Zone A (ของใช้ทั่วไป)</option>
						<option value="Zone B">Zone B (ของที่เน่าเสียได้)</option>
						<option value="Zone C">Zone C (ยาและเวชภัณฑ์)</option>
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Expiry Date (lot.expiry) -->
		<Form.Field {form} name="lot.expiry" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<div class="mb-1 flex items-center justify-between">
						<Form.Label class="text-xs font-bold text-foreground">
							วันหมดอายุ
							{#if selectedItem?.perishable}
								<span class="font-bold text-rose-600 dark:text-rose-400"
									>* (ของเสียได้ บังคับกรอก)</span
								>
							{/if}
						</Form.Label>
						<div class="flex gap-1.5">
							<button
								type="button"
								class="cursor-pointer rounded-full border border-border bg-background px-2.5 py-0.5 text-2xs font-bold text-muted-foreground shadow-sm transition hover:bg-muted"
								onclick={() => setQuickExpiry(3)}
							>
								+3 วัน
							</button>
							<button
								type="button"
								class="cursor-pointer rounded-full border border-border bg-background px-2.5 py-0.5 text-2xs font-bold text-muted-foreground shadow-sm transition hover:bg-muted"
								onclick={() => setQuickExpiry(7)}
							>
								+7 วัน
							</button>
						</div>
					</div>
					<Input
						{...props}
						type="date"
						value={$formData.lot?.expiry ?? ''}
						oninput={(e) => {
							if (!$formData.lot) {
								$formData.lot = { expiry: e.currentTarget.value, note: '' };
							} else {
								$formData.lot.expiry = e.currentTarget.value;
							}
						}}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Submit Button -->
		<div class="col-span-1 pt-3 sm:col-span-2">
			<Form.Button
				disabled={$submitting}
				class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:scale-[1.02] hover:bg-primary/95 hover:shadow-lg active:scale-[0.98]"
			>
				{$submitting ? 'กำลังบันทึกรายการ...' : 'ลงทะเบียนบันทึกของเข้าคลัง'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
