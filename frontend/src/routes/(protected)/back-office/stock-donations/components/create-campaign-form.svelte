<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import { toast } from 'svelte-sonner';
	import PublicDisplayHint from './public-display-hint.svelte';
	import { useSupplyItems } from '$lib/features/supply';
	import { mergeCatalogGenerations, useItemMasters } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { persistQty, qtyGt } from '$lib/utils/qty';

	interface Props {
		onclose: () => void;
		onsubmit: (input: {
			itemId: string;
			name: string;
			target: string;
			location: string;
			category?: string;
			unit?: string;
			urgency?: 'critical' | 'important' | 'normal';
			imageUrl?: string;
			description?: string;
		}) => void;
	}

	let { onclose, onsubmit }: Props = $props();

	/**
	 * The item is PICKED from the catalog, never guessed from what staff typed.
	 *
	 * This box used to be free text run through `mapNeedItemHeuristic`, which matched
	 * bare substrings: "มาม่าน้ำข้น" contains "น้ำ", so a noodle campaign bound itself to
	 * `item:water` and merged into the drinking-water card on the donor board (the
	 * public projection is keyed `{shelter}:{item_id}` and names the card from the
	 * catalog — schema.md §2.4). Staff had no way to see the wrong binding before
	 * saving. Picking the catalog row makes the binding the thing being chosen.
	 */
	let selectedItemId = $state('');
	// `null` = "still following the catalog's value". Set the moment staff pick for
	// themselves, so changing the item cannot undo their choice.
	let categoryChoice = $state<string | null>(null);
	let targetQty = $state('');
	const STANDARD_UNITS = [
		'ชิ้น',
		'กล่อง',
		'แพ็ค',
		'ขวด',
		'กระป๋อง',
		'กิโลกรัม',
		'ถุง',
		'ผืน',
		'ชุด',
		'ก้อน',
		'ลัง',
		'ม้วน',
		'คู่',
		'แผง',
		'ซอง'
	];

	const CATEGORY_OPTIONS = [
		{ value: 'อาหารและเครื่องดื่ม', label: 'อาหารและเครื่องดื่ม (Food & Beverage)' },
		{ value: 'ยารักษาโรคและเวชภัณฑ์', label: 'ยารักษาโรคและเวชภัณฑ์ (Medical Supplies)' },
		{ value: 'ของใช้ทั่วไปและสุขอนามัย', label: 'ของใช้ทั่วไปและสุขอนามัย (General & Hygiene)' },
		{ value: 'เครื่องนุ่งห่มและที่นอน', label: 'เครื่องนุ่งห่มและที่นอน (Clothing & Bedding)' },
		{ value: 'แม่และเด็ก', label: 'แม่และเด็ก (Mother & Child)' },
		{ value: 'อุปกรณ์และเครื่องมือช่าง', label: 'อุปกรณ์และเครื่องมือช่าง (Tools & Equipment)' },
		{ value: 'อื่นๆ', label: 'อื่นๆ (Other)' }
	];

	const URGENCY_OPTIONS = [
		{ value: 'critical', label: 'วิกฤต (Critical)' },
		{ value: 'important', label: 'สำคัญ (Important)' },
		{ value: 'normal', label: 'ปกติ (Normal)' }
	] as const;

	let unitChoice = $state<string | null>(null);
	let customUnit = $state('');
	let urgency = $state<'critical' | 'important' | 'normal'>('critical');
	let imageUrl = $state('');
	let description = $state('');

	// Same two sources the scan station and the hint below read, so all three agree on
	// what "the catalog" is.
	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());

	// Both generations of the catalog, de-duplicated by name (schema.md §4.2) — the
	// seed carries `item:rice` AND `item_master:rice`, and the picker listed both.
	const catalogItems = $derived(
		mergeCatalogGenerations(supplyItemsQuery.data ?? [], itemMastersQuery.data ?? [])
	);
	const catalogLoading = $derived(supplyItemsQuery.isPending || itemMastersQuery.isPending);
	const catalogOptions = $derived(
		catalogItems.map((c) => ({
			value: c._id,
			label: c.unit ? `${c.name} (${c.unit})` : c.name
		}))
	);
	const selectedItem = $derived(catalogItems.find((c) => c._id === selectedItemId));

	/**
	 * Catalog rows carry a code (`food`, `hygiene`, …); this form's dropdown is the
	 * Thai back-office wording. Unmapped codes fall through to the plain default —
	 * the category lives in `notes` and is back-office-only, so a miss is cosmetic.
	 */
	const CATALOG_CATEGORY_TO_FORM: Record<string, string> = {
		food: 'อาหารและเครื่องดื่ม',
		water: 'อาหารและเครื่องดื่ม',
		medicine: 'ยารักษาโรคและเวชภัณฑ์',
		medical: 'ยารักษาโรคและเวชภัณฑ์',
		hygiene: 'ของใช้ทั่วไปและสุขอนามัย',
		general: 'ของใช้ทั่วไปและสุขอนามัย',
		clothing: 'เครื่องนุ่งห่มและที่นอน',
		bedding: 'เครื่องนุ่งห่มและที่นอน',
		baby: 'แม่และเด็ก',
		tools: 'อุปกรณ์และเครื่องมือช่าง'
	};

	const mappedItemId = $derived(selectedItemId);
	const category = $derived(
		categoryChoice ??
			CATALOG_CATEGORY_TO_FORM[selectedItem?.category ?? ''] ??
			'อาหารและเครื่องดื่ม'
	);
	// Default to the catalog's own unit — that is the one donors are shown, so
	// matching it is what keeps the mismatch warning below quiet.
	const catalogUnit = $derived(selectedItem?.unit?.trim() ?? '');
	const selectedUnitOption = $derived(
		unitChoice ??
			(catalogUnit ? (STANDARD_UNITS.includes(catalogUnit) ? catalogUnit : 'custom') : 'ชิ้น')
	);
	const finalUnit = $derived(
		selectedUnitOption === 'custom'
			? customUnit.trim() || (STANDARD_UNITS.includes(catalogUnit) ? '' : catalogUnit)
			: selectedUnitOption
	);
	const categoryLabel = $derived(
		CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category
	);
	const unitLabel = $derived(
		selectedUnitOption === 'custom' ? 'ระบุหน่วยเอง (Custom)...' : selectedUnitOption
	);
	const urgencyLabel = $derived(URGENCY_OPTIONS.find((o) => o.value === urgency)?.label ?? urgency);

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!selectedItemId || !selectedItem) {
			toast.error('กรุณาเลือกรายการสิ่งของจากแคตตาล็อก');
			return;
		}
		if (!targetQty.trim() || !qtyGt(targetQty, 0)) {
			toast.error('กรุณาระบุจำนวนเป้าหมายที่ถูกต้อง');
			return;
		}
		if (!description.trim()) {
			toast.error('กรุณาระบุเหตุผลหรือรายละเอียดเพิ่มเติม');
			return;
		}

		onsubmit({
			itemId: selectedItemId,
			name: selectedItem.name,
			target: persistQty(targetQty),
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			category: category.trim() || 'ของใช้ทั่วไป',
			unit: finalUnit || 'ชิ้น',
			urgency,
			...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
			description: description.trim()
		});
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Top Dark Navy Banner -->
	<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
		<Button
			variant="link"
			size="sm"
			type="button"
			onclick={onclose}
			class="mb-3 h-auto gap-1.5 p-0 text-xs font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าจัดการความต้องการ
		</Button>
		<div class="flex items-center gap-2.5">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
				<Megaphone class="h-5 w-5" />
			</div>
			<h2 class="text-base font-bold text-white md:text-lg">สร้างประกาศขอรับบริจาค</h2>
		</div>
		<p class="mt-1 text-xs text-blue-100/80">
			กำหนดรายการสิ่งของและจำนวนที่ต้องการ เพื่อประกาศให้ประชาชนทราบผ่านหน้าเว็บไซต์
		</p>
	</div>

	<!-- Form Body -->
	<form onsubmit={handleSubmit} class="space-y-6 p-6 md:p-8">
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-xs font-bold text-foreground md:text-sm">
				<PlusCircle class="h-4 w-4 text-muted-foreground" />
				รายละเอียดสิ่งของ
			</h3>

			<!-- Item — picked from the catalog, not typed -->
			<div>
				<Label for="campaign-item-title" class="mb-1.5 text-xs font-bold text-foreground">
					รายการสิ่งของ (Item) <span class="text-destructive">*</span>
				</Label>
				<SearchSelect
					items={catalogOptions}
					bind:value={selectedItemId}
					loading={catalogLoading}
					placeholder="พิมพ์เพื่อค้นหารายการในแคตตาล็อก..."
					emptyText="ไม่พบรายการนี้ในแคตตาล็อก — สร้างในหน้าจัดการข้อมูลหลักก่อน"
					class="h-10 rounded-xl text-xs"
					controlProps={{ id: 'campaign-item-title' }}
				/>
				<p class="mt-1.5 text-3xs text-muted-foreground">
					ประกาศผูกกับรหัสในแคตตาล็อกโดยตรง — ไม่ได้เดาจากชื่อที่พิมพ์อีกต่อไป ถ้ายังไม่มีรายการนี้
					ให้สร้างในหน้าจัดการข้อมูลหลักก่อน
				</p>
			</div>

			<!-- Category -->
			<div>
				<Label for="campaign-item-category" class="mb-1.5 text-xs font-bold text-foreground">
					หมวดหมู่สิ่งของ (Category)
				</Label>
				<Select.Root type="single" value={category} onValueChange={(v) => (categoryChoice = v)}>
					<Select.Trigger
						id="campaign-item-category"
						class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10"
					>
						{categoryLabel}
					</Select.Trigger>
					<Select.Content>
						{#each CATEGORY_OPTIONS as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Target Qty and Unit (2 columns) -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<Label for="campaign-target-qty" class="mb-1.5 text-xs font-bold text-foreground">
						จำนวนเป้าหมาย (Target Quantity) <span class="text-destructive">*</span>
					</Label>
					<Input
						id="campaign-target-qty"
						type="text"
						inputmode="decimal"
						placeholder="เช่น 100, 500"
						bind:value={targetQty}
						class="h-10 rounded-xl text-xs"
					/>
				</div>

				<div>
					<Label for="campaign-item-unit" class="mb-1.5 text-xs font-bold text-foreground">
						หน่วยนับ (Unit of Measure)
					</Label>
					<div class="space-y-2">
						<Select.Root
							type="single"
							value={selectedUnitOption}
							onValueChange={(v) => (unitChoice = v)}
						>
							<Select.Trigger
								id="campaign-item-unit"
								class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10"
							>
								{unitLabel}
							</Select.Trigger>
							<Select.Content>
								{#each STANDARD_UNITS as option (option)}
									<Select.Item value={option} label={option} />
								{/each}
								<Select.Item value="custom" label="ระบุหน่วยเอง (Custom)..." />
							</Select.Content>
						</Select.Root>
						{#if selectedUnitOption === 'custom'}
							<!-- Left blank, the campaign takes the catalog's own unit (see `finalUnit`),
							     which is the one donors are shown — so the placeholder states it rather
							     than looking like an unfilled required box. -->
							<Input
								type="text"
								placeholder={catalogUnit
									? `ใช้หน่วยจากแคตตาล็อก: ${catalogUnit}`
									: 'พิมพ์ระบุหน่วยนับ...'}
								bind:value={customUnit}
								class="h-10 rounded-xl text-xs"
							/>
						{/if}
					</div>
				</div>
			</div>

			{#if mappedItemId}
				<PublicDisplayHint itemId={mappedItemId} typedUnit={finalUnit} />
			{/if}

			<!-- Urgency Level and Image URL (2 columns) -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<Label for="campaign-urgency" class="mb-1.5 text-xs font-bold text-foreground">
						ความเร่งด่วน (Urgency Level)
					</Label>
					<Select.Root type="single" bind:value={urgency}>
						<Select.Trigger
							id="campaign-urgency"
							class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10"
						>
							{urgencyLabel}
						</Select.Trigger>
						<Select.Content>
							{#each URGENCY_OPTIONS as option (option.value)}
								<Select.Item value={option.value} label={option.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div>
					<Label for="campaign-image-url" class="mb-1.5 text-xs font-bold text-foreground">
						ภาพประกอบสิ่งของ (Image URL - Optional)
					</Label>
					<Input
						id="campaign-image-url"
						type="url"
						placeholder="https://example.com/image.png"
						bind:value={imageUrl}
						class="h-10 rounded-xl text-xs"
					/>
				</div>
			</div>

			<!-- Reason / Details -->
			<div>
				<Label for="campaign-description" class="mb-1.5 text-xs font-bold text-foreground">
					เหตุผลหรือรายละเอียดเพิ่มเติม (Reason / Details) <span class="text-destructive">*</span>
				</Label>
				<Textarea
					id="campaign-description"
					rows={3}
					placeholder="ระบุวัตถุประสงค์ในการประกาศขอรับ เช่น สำหรับใช้ทำอาหารแจกจ่ายประจำวัน หรือ สำหรับผู้ประสบภัยที่บ้านเรือนพังเสียหาย..."
					bind:value={description}
					class="rounded-xl text-xs"
				/>
			</div>
		</div>

		<!-- Footer Action Buttons -->
		<div class="flex items-center justify-end gap-3 border-t border-border/60 pt-6">
			<Button
				variant="ghost"
				type="button"
				onclick={onclose}
				class="h-10 rounded-xl px-5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				ยกเลิก
			</Button>

			<Button
				type="submit"
				class="flex h-10 items-center gap-2 rounded-xl bg-[#002D5B] px-6 text-xs font-bold text-white shadow-sm hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				<Megaphone class="h-4 w-4" />
				ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ
			</Button>
		</div>
	</form>
</div>
