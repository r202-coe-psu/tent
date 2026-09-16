<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Save from '@lucide/svelte/icons/save';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { parseCampaignNotes, type NeedItem } from '$lib/features/operations';
	import { persistQty, qtyGt, roundQty } from '$lib/utils/qty';
	import PublicDisplayHint from './public-display-hint.svelte';
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';

	interface Props {
		item: NeedItem;
		/** Which need of the campaign the board row was for. */
		itemId: string;
		onclose: () => void;
		onsubmit: (updatedData: {
			title: string;
			category: string;
			unit: string;
			target: string;
			urgency: 'critical' | 'important' | 'normal';
			imageUrl: string;
			description: string;
		}) => void;
	}

	let { item, itemId, onclose, onsubmit }: Props = $props();

	const CATEGORY_OPTIONS = [
		'อาหารและเครื่องดื่ม',
		'ยารักษาโรคและเวชภัณฑ์',
		'ของใช้ทั่วไปและสุขอนามัย',
		'เครื่องนุ่งห่มและที่นอน',
		'แม่และเด็ก',
		'อุปกรณ์และเครื่องมือช่าง',
		'อื่นๆ'
	];

	/**
	 * Seeded ONCE from the row the user clicked — `untrack` says so out loud: the
	 * campaigns query refetches on its own, and re-seeding from a fresh `item` would
	 * wipe whatever the user had typed mid-edit. The parent keys this component on
	 * the row, so picking another row mounts a new form with its own seed.
	 */
	const seed = untrack(() => ({
		need: item.needs.find((n) => n.itemId === itemId),
		notes: parseCampaignNotes(item.location),
		title: item.title
	}));
	const editedNeed = seed.need;

	let campaignTitle = $state(seed.title);
	let category = $state(
		seed.notes.category && CATEGORY_OPTIONS.includes(seed.notes.category)
			? seed.notes.category
			: 'อื่นๆ'
	);
	let targetQty = $state(editedNeed?.target ?? '0');
	let urgency = $state<'critical' | 'important' | 'normal'>(seed.notes.urgency);
	// Seeded like every other note-borne field: the save below rebuilds the whole
	// notes string, so a value this form does not read back is dropped on save.
	let imageUrl = $state(seed.notes.imageUrl ?? '');
	let description = $state(seed.notes.description ?? '');

	// What donors already pledged against this need. Read-only: it is derived from
	// donation docs, and lowering the target below it is what Force Cut-off is for.
	const pledged = roundQty(editedNeed?.reserved ?? '0');

	/**
	 * A target below what donors already pledged is refused HERE, at the point of entry.
	 *
	 * The donor-facing ceiling (`donation_need_counter.qty_target` in Mongo) now follows
	 * this field — the worker realigns it on the campaign's CDC event — but it will not
	 * follow it below `reserved_qty`: those bookings were accepted at the old ceiling and
	 * are still owed, so a lower target would make `reserved_qty <= qty_target` false for
	 * reservations that already exist. The worker refuses that write and logs it, which
	 * is invisible from here; saying no in the form is what makes the rule legible.
	 *
	 * Lowering to EXACTLY the pledged figure is allowed — the need goes full rather than
	 * over-full. Closing a need that is still short is what Force Cut-off is for.
	 */
	const belowPledged = $derived(
		!!targetQty.trim() && qtyGt(targetQty, 0) && qtyGt(pledged, targetQty)
	);

	const URGENCY_OPTIONS = [
		{ value: 'normal', label: 'ปกติ (Normal)' },
		{ value: 'important', label: 'สำคัญ (Important)' },
		{ value: 'critical', label: 'วิกฤต (Critical)' }
	] as const;

	/**
	 * The unit is the CATALOG's, never one staff picked for this campaign — the same
	 * rule the create form states at length. `qty_target` is subtracted from
	 * `stock_ledger.qty`, which §2.1 pins to `item_master.base_unit`, so a campaign
	 * that carried its own unit made that subtraction meaningless and disagreed with
	 * the donor board, which names the card from the catalog regardless.
	 *
	 * Editing an existing need re-reads the catalog rather than trusting `needs[].unit`
	 * as stored: campaigns written before this was enforced carry whatever staff typed,
	 * and saving one of those forms is what corrects it.
	 */
	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	/**
	 * Looked up by EXACT id across both generations, never through
	 * `mergeCatalogGenerations` — that de-duplicates by NAME and drops the losing
	 * generation's row (`LEGACY_WINS`, `catalog.ts`), so a need bound to
	 * `item_master:rice` while `item:rice` also exists would find nothing and keep the
	 * wrong stored unit. Same reason `useDonationNeedsBoard` keys its name map by id.
	 */
	const catalogUnit = $derived.by(() => {
		const supply = (supplyItemsQuery.data ?? []).find((i) => i._id === itemId);
		if (supply?.unit) return supply.unit.trim();
		const master = (itemMastersQuery.data ?? []).find((m) => m._id === itemId);
		if (master && !master.deactivated) return itemMasterUnit(master).trim();
		return '';
	});
	// While the catalog is still loading — or when the need points at an id no catalog
	// row claims — keep the stored unit rather than blanking the field and failing the
	// submit guard below on a save the user did not mean to change.
	const finalUnit = $derived(catalogUnit || (editedNeed?.unit ?? ''));
	const urgencyLabel = $derived(URGENCY_OPTIONS.find((o) => o.value === urgency)?.label ?? urgency);

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!campaignTitle.trim()) {
			toast.error('กรุณาระบุชื่อประกาศ');
			return;
		}
		if (!finalUnit) {
			toast.error('กรุณาระบุหน่วยนับ');
			return;
		}
		if (!targetQty.trim() || !qtyGt(targetQty, 0)) {
			toast.error('กรุณาระบุจำนวนเป้าหมายที่ถูกต้อง');
			return;
		}
		if (belowPledged) {
			toast.error(
				`ตั้งเป้าต่ำกว่ายอดที่ผู้บริจาคจองไว้แล้ว (${pledged} ${finalUnit}) ไม่ได้ — ใช้ Force Cut-off เพื่อปิดรับแทน`
			);
			return;
		}

		onsubmit({
			title: campaignTitle.trim(),
			category: category.trim(),
			unit: finalUnit,
			target: persistQty(targetQty),
			urgency,
			imageUrl: imageUrl.trim(),
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
				<SlidersHorizontal class="h-5 w-5" />
			</div>
			<h2 class="text-base font-bold text-white md:text-lg">แก้ไขประกาศ (Edit Campaign)</h2>
		</div>
		<p class="mt-1 text-xs text-blue-100/80">
			แก้ไขรายละเอียดกระดานแจ้งความต้องการด่วน — รายการที่แก้: {editedNeed?.name || itemId}
		</p>
	</div>

	<!-- Form Body -->
	<form onsubmit={handleSubmit} class="space-y-6 p-6 md:p-8">
		<!-- Row 1: Campaign title & Category -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<Label for="edit-campaign-title" class="mb-1.5 text-xs font-bold text-foreground">
					ชื่อประกาศ (Campaign) <span class="text-destructive">*</span>
				</Label>
				<Input
					id="edit-campaign-title"
					type="text"
					bind:value={campaignTitle}
					class="h-10 rounded-xl text-xs"
				/>
			</div>

			<div>
				<Label for="edit-item-category" class="mb-1.5 text-xs font-bold text-foreground">
					หมวดหมู่ (Category)
				</Label>
				<Select.Root type="single" bind:value={category}>
					<Select.Trigger
						id="edit-item-category"
						class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10"
					>
						{category}
					</Select.Trigger>
					<Select.Content>
						{#each CATEGORY_OPTIONS as option (option)}
							<Select.Item value={option} label={option} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<!-- Row 2: the need being edited -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<span class="mb-1.5 block text-xs font-bold text-foreground">รายการพัสดุ (Item)</span>
				<div
					class="flex h-10 items-center rounded-xl border border-border/60 bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
					title="ผูกกับรหัสในแคตตาล็อก ({itemId}) — เปลี่ยนชื่อที่นี่ไม่ได้"
				>
					{editedNeed?.name || itemId}
				</div>
			</div>

			<div>
				<span class="mb-1.5 block text-xs font-bold text-foreground">หน่วย (Unit)</span>
				<div
					class="flex h-10 items-center rounded-xl border border-border/60 bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
					title="หน่วยฐานจากแคตตาล็อก — แก้ที่นี่ไม่ได้ เพราะยอดคงคลังนับด้วยหน่วยนี้"
				>
					{finalUnit || '—'}
				</div>
				<p class="mt-1.5 text-3xs text-muted-foreground">
					มาจากหน่วยฐานของรายการในแคตตาล็อก — ต้องแก้ที่แคตตาล็อกถ้าไม่ถูกต้อง
				</p>
			</div>

			<div>
				<Label for="edit-item-target" class="mb-1.5 text-xs font-bold text-foreground">
					เป้าหมายที่ต้องการ (Target) <span class="text-destructive">*</span>
				</Label>
				<Input
					id="edit-item-target"
					type="text"
					inputmode="decimal"
					bind:value={targetQty}
					class="h-10 rounded-xl text-xs"
				/>
				<p class="mt-1.5 text-3xs text-muted-foreground">
					ผู้บริจาคจองไว้แล้ว {pledged}
					{finalUnit} — ตั้งเป้าเท่ากับยอดนี้จะทำให้รายการปิดรับทันที และตั้งต่ำกว่านี้ไม่ได้
				</p>
			</div>
		</div>

		{#if belowPledged}
			<Alert.Root variant="destructive" class="rounded-2xl border-destructive/40 bg-destructive/5">
				<TriangleAlert />
				<Alert.Title class="text-xs font-bold">ตั้งเป้าต่ำกว่ายอดที่จองไว้แล้วไม่ได้</Alert.Title>
				<Alert.Description class="text-2xs leading-relaxed">
					ผู้บริจาคจองไว้แล้ว {pledged}
					{finalUnit} ซึ่งเป็นคำสัญญาที่ให้ไปแล้วและยังต้องรับของ — ตั้งเป้าต่ำกว่านี้จะทำให้ยอดจองเกินเป้า
					ระบบจึงไม่ลดเพดานฝั่งผู้บริจาคตาม ถ้าต้องการหยุดรับบริจาครายการนี้ ให้ใช้
					<span class="font-bold">Force Cut-off</span> แทนการลดเป้า
				</Alert.Description>
			</Alert.Root>
		{/if}

		<PublicDisplayHint {itemId} />

		<!-- Row 3: Urgency Level & Image URL -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<Label for="edit-item-urgency" class="mb-1.5 text-xs font-bold text-foreground">
					ความเร่งด่วน (Urgency Level)
				</Label>
				<Select.Root type="single" bind:value={urgency}>
					<Select.Trigger
						id="edit-item-urgency"
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
				<Label for="edit-item-image-url" class="mb-1.5 text-xs font-bold text-foreground">
					ภาพประกอบสิ่งของ (Image URL - Optional)
				</Label>
				<Input
					id="edit-item-image-url"
					type="url"
					placeholder="https://example.com/image.png"
					bind:value={imageUrl}
					class="h-10 rounded-xl text-xs"
				/>
			</div>
		</div>

		<!-- Row 4: Reason / Details -->
		<div>
			<Label for="edit-item-details" class="mb-1.5 text-xs font-bold text-foreground">
				เหตุผล/รายละเอียดเพิ่มเติม (Reason/Details)
			</Label>
			<Textarea
				id="edit-item-details"
				rows={3}
				placeholder="เช่น ต้องการด่วนสำหรับผู้ป่วยติดเตียง..."
				bind:value={description}
				class="rounded-xl text-xs"
			/>
			<p class="mt-1.5 text-3xs text-muted-foreground">
				ข้อความนี้แสดงใต้ชื่อประกาศบนกระดาน และเก็บความเร่งด่วน/หมวดหมู่ไว้ในบรรทัดเดียวกัน
			</p>
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
				<Save class="h-4 w-4" />
				บันทึกการแก้ไข
			</Button>
		</div>
	</form>
</div>
