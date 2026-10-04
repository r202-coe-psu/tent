<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import CameraCodeScannerDialog from '$lib/components/camera-code-scanner-dialog.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { cn } from '$lib/utils/shadcn.js';
	import { qtyGt, qtyLte } from '$lib/utils/qty';
	import {
		QuickCreateItemDialog,
		canWriteShelterCatalog,
		findItemByBarcode,
		looksLikeBarcode,
		type ItemMaster
	} from '$lib/features/catalog';
	import {
		filterStockFormItems,
		toStockFormItems,
		type StockFormItem
	} from '../domain/stock-form-items';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ScanBarcodeIcon from '@lucide/svelte/icons/scan-barcode';
	import XIcon from '@lucide/svelte/icons/x';

	/** Extra context for a selection that did not come from clicking a list row. */
	export type ItemSelectMeta = {
		/** The unit a scanned pack barcode identifies. */
		uom?: string;
		/** The item was just created from this combobox. */
		created?: boolean;
	};

	let {
		items = [],
		value = $bindable(''),
		disabled = false,
		isLoading = false,
		balanceByItemId,
		disableWhenEmpty = false,
		formatBalanceUnit,
		placeholder = 'ค้นหา…',
		emptyText = 'ไม่พบสินค้า',
		allowCreate = false,
		onSelect,
		id,
		name,
		class: className,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedBy
	}: {
		items?: StockFormItem[];
		value?: string;
		disabled?: boolean;
		isLoading?: boolean;
		balanceByItemId?: ReadonlyMap<string, string>;
		disableWhenEmpty?: boolean;
		formatBalanceUnit?: (item: StockFormItem) => string;
		placeholder?: string;
		emptyText?: string;
		/** Offer "+ สร้างสินค้าใหม่" (quick-create) to roles that may write the shelter catalog. */
		allowCreate?: boolean;
		onSelect?: (item: StockFormItem | null, meta?: ItemSelectMeta) => void;
		id?: string;
		name?: string;
		class?: string;
		'aria-invalid'?: boolean | 'true' | 'false' | undefined;
		'aria-describedby'?: string | undefined;
	} = $props();

	/** Sentinel value of the "create" row; never leaves this component. */
	const CREATE_VALUE = '__create_item__';

	let searchValue = $state('');
	let open = $state(false);

	const selectedItem = $derived(items.find((item) => item._id === value) ?? null);

	const filteredItems = $derived(filterStockFormItems(items, searchValue));

	const query = $derived(searchValue.trim());
	const queryIsBarcode = $derived(looksLikeBarcode(query));
	const shelterCode = $derived(getShelterCode());
	const canCreate = $derived(
		allowCreate && !!shelterCode && canWriteShelterCatalog(authStore.user?.roles ?? [])
	);

	const hasNameMatch = $derived.by(() => {
		const needle = query.toLowerCase();
		return filteredItems.some(
			(item) => item.name.toLowerCase() === needle || item.sku?.toLowerCase() === needle
		);
	});
	const showNearHeading = $derived(query !== '' && filteredItems.length > 0 && !hasNameMatch);

	const createLabel = $derived(
		query === ''
			? 'สร้างสินค้าใหม่'
			: queryIsBarcode
				? `สร้างสินค้าใหม่จากบาร์โค้ด ${query}`
				: `สร้างสินค้าใหม่ “${query}”`
	);

	const typeaheadItems = $derived([
		...items.map((item) => ({
			value: item._id,
			label: item.name,
			disabled: isItemDisabled(item)
		})),
		...(canCreate ? [{ value: CREATE_VALUE, label: createLabel, disabled: false }] : [])
	]);

	function balanceOf(item: StockFormItem): string {
		return balanceByItemId?.get(item._id) ?? '0';
	}

	function isItemDisabled(item: StockFormItem): boolean {
		if (!disableWhenEmpty || !balanceByItemId) return false;
		return qtyLte(balanceOf(item), 0);
	}

	function unitLabel(item: StockFormItem): string {
		return formatBalanceUnit?.(item) ?? item.unit;
	}

	function handleValueChange(next: string) {
		if (next === CREATE_VALUE) {
			openCreate();
			return;
		}
		value = next;
		const item = items.find((i) => i._id === next) ?? null;
		if (item) searchValue = item.name;
		onSelect?.(item);
	}

	function clearSelection() {
		value = '';
		searchValue = '';
		onSelect?.(null);
	}

	function handleOpenChangeComplete(isOpen: boolean) {
		if (!isOpen) {
			searchValue = selectedItem?.name ?? '';
		}
	}

	// ---------------------------------------------------------------- picking by id / barcode

	/** Select an item that was found outside the list (scan, "ใช้ตัวนี้แทน", just created). */
	function pick(item: StockFormItem, meta?: ItemSelectMeta) {
		if (isItemDisabled(item)) {
			toast.error(`“${item.name}” ไม่มียอดในคลัง จึงเลือกไม่ได้`);
			return;
		}
		value = item._id;
		searchValue = item.name;
		onSelect?.(item, meta);
	}

	function handleBarcode(code: string) {
		const match = findItemByBarcode(items, code);
		if (match) {
			toast.success(`พบ “${match.item.name}” จากบาร์โค้ด`);
			pick(match.item, { uom: match.uom });
			open = false;
			return;
		}
		if (canCreate) {
			openCreate(code);
			return;
		}
		toast.error(`ไม่พบสินค้าที่ตรงกับบาร์โค้ด ${code}`);
	}

	function handleInputKeydown(event: KeyboardEvent) {
		// A keyboard-wedge scanner types the digits then Enter.
		if (event.key !== 'Enter' || !queryIsBarcode) return;
		event.preventDefault();
		event.stopPropagation();
		handleBarcode(query);
	}

	let scanOpen = $state(false);

	// ---------------------------------------------------------------- quick-create

	let createOpen = $state(false);
	let createName = $state('');
	let createBarcode = $state('');
	/** Set between the dialog closing and its close animation ending. */
	let pendingPick = $state<{ item: ItemMaster; created: boolean } | null>(null);

	function openCreate(barcode?: string) {
		const code = barcode ?? (queryIsBarcode ? query : '');
		createBarcode = code;
		createName = code ? '' : query;
		open = false;
		createOpen = true;
	}

	function finishPick() {
		const picked = pendingPick;
		pendingPick = null;
		if (!picked) return;
		const { item: master, created } = picked;

		const existing = items.find((i) => i._id === master._id);
		const stockItem = existing ?? toStockFormItems([], [master])[0];

		if (!created) {
			pick(stockItem);
			return;
		}

		toast.success(`สร้าง “${master.name}” แล้ว`, {
			action: {
				label: 'เติมข้อมูลเสริมทีหลัง',
				onClick: () =>
					goto(
						resolve(
							`/back-office/supply?tab=catalog&edit=${encodeURIComponent(master._id)}` as '/back-office/supply'
						)
					)
			}
		});

		if (disableWhenEmpty) {
			// Nothing in stock yet, so this form cannot use it — it must be received first.
			toast.info(`“${master.name}” ยังไม่มียอดในคลัง ต้องรับเข้าก่อนจึงจะเลือกในรายการนี้ได้`);
			return;
		}
		pick(stockItem, { created: true });
	}
</script>

<Combobox.Root
	type="single"
	bind:value={() => value, handleValueChange}
	bind:open
	{disabled}
	{name}
	items={typeaheadItems}
	allowDeselect={false}
	inputValue={selectedItem?.name}
	onOpenChangeComplete={handleOpenChangeComplete}
>
	<div class="relative w-full">
		<Combobox.Input
			{id}
			{placeholder}
			aria-invalid={ariaInvalid}
			aria-describedby={ariaDescribedBy}
			autocomplete="off"
			oninput={(e) => {
				searchValue = e.currentTarget.value;
			}}
			onkeydown={handleInputKeydown}
			class={cn(
				'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 pr-28 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:font-bold disabled:text-muted-foreground disabled:opacity-100',
				className
			)}
		/>
		<div class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
			{#if selectedItem && !disabled}
				<Button
					type="button"
					variant="ghost"
					class="min-h-9 min-w-9 px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						clearSelection();
					}}
				>
					<span class="sr-only">ล้าง</span>
					<XIcon class="size-4" />
				</Button>
			{/if}
			{#if !disabled}
				<Button
					type="button"
					variant="ghost"
					class="min-h-9 min-w-9 px-2 text-muted-foreground hover:text-foreground"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						scanOpen = true;
					}}
				>
					<span class="sr-only">สแกนบาร์โค้ด</span>
					<ScanBarcodeIcon class="size-4" />
				</Button>
			{/if}
			<Combobox.Trigger
				class="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:pointer-events-none"
				{disabled}
			>
				<ChevronsUpDownIcon class="size-4 opacity-50" />
			</Combobox.Trigger>
		</div>
	</div>

	<Combobox.Portal>
		<Combobox.Content
			class="z-50 max-h-72 w-[var(--bits-combobox-anchor-width)] min-w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-xl outline-none"
			sideOffset={4}
		>
			<Combobox.Viewport class="max-h-64 overflow-y-auto">
				{#if isLoading}
					<div class="p-3 text-xs text-muted-foreground">กำลังโหลด…</div>
				{:else}
					{#if showNearHeading}
						<div class="px-3 py-1.5 text-xs font-bold text-muted-foreground">
							ไม่พบชื่อตรงกัน · ชื่อใกล้เคียง
						</div>
					{/if}
					{#each filteredItems as item (item._id)}
						{@const bal = balanceOf(item)}
						{@const itemDisabled = isItemDisabled(item)}
						<Combobox.Item
							value={item._id}
							label={item.name}
							disabled={itemDisabled}
							class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted"
						>
							{#snippet children({ selected })}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span
											class="truncate font-semibold text-foreground {itemDisabled
												? 'opacity-50'
												: ''}"
										>
											{item.name}
										</span>
										{#if selected}
											<CheckIcon class="size-3.5 shrink-0 text-primary" />
										{/if}
									</div>
									{#if item.sku}
										<div class="font-mono text-2xs text-muted-foreground">{item.sku}</div>
									{/if}
								</div>
								{#if balanceByItemId}
									<span
										class="shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold {qtyGt(bal, 0)
											? 'border-primary/20 bg-primary/10 text-primary'
											: 'border-destructive/20 bg-destructive/10 text-destructive'}"
									>
										{bal}
										{unitLabel(item)}
									</span>
								{/if}
							{/snippet}
						</Combobox.Item>
					{/each}
					{#if filteredItems.length === 0 && !canCreate}
						<div class="p-3 text-xs text-muted-foreground">{emptyText}</div>
					{/if}
					{#if canCreate}
						{#if filteredItems.length > 0}
							<div class="my-1 h-px bg-border" role="separator"></div>
						{:else}
							<div class="px-3 py-1.5 text-xs text-muted-foreground">{emptyText}</div>
						{/if}
						<!-- `label` is the search text so selecting this row leaves the input as typed. -->
						<Combobox.Item
							value={CREATE_VALUE}
							label={searchValue}
							class="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-bold text-sky-900 outline-none data-highlighted:bg-sky-50"
						>
							<span
								class="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white"
							>
								<PlusIcon class="size-4" aria-hidden="true" />
							</span>
							<span class="min-w-0 flex-1 truncate">{createLabel}</span>
						</Combobox.Item>
					{/if}
				{/if}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

<CameraCodeScannerDialog
	bind:open={scanOpen}
	title="สแกนบาร์โค้ดสินค้า"
	hint="เล็งกล้องไปที่บาร์โค้ดที่ตัวสินค้า หรือพิมพ์รหัสด้วยมือ / เครื่องสแกนบาร์โค้ด"
	onScan={handleBarcode}
/>

{#if canCreate && shelterCode}
	<QuickCreateItemDialog
		bind:open={createOpen}
		{shelterCode}
		initialName={createName}
		initialBarcode={createBarcode}
		submitLabel={disableWhenEmpty ? 'สร้างสินค้า' : 'สร้างแล้วใช้ในรายการนี้'}
		backLabel="กลับ (ข้อมูลที่กรอกไว้ยังอยู่)"
		onCreated={(item) => (pendingPick = { item, created: true })}
		onUseExisting={(item) => (pendingPick = { item, created: false })}
		onOpenChangeComplete={(isOpen) => {
			if (!isOpen) finishPick();
		}}
		onCloseAutoFocus={(event) => {
			// Focus goes to the form's next field (e.g. quantity), not back to the search box.
			if (pendingPick) event.preventDefault();
		}}
	/>
{/if}
