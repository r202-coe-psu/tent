<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Save from '@lucide/svelte/icons/save';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { parseCampaignNotes, type NeedItem } from '$lib/features/operations';
	import { persistQty, qtyGt, roundQty } from '$lib/utils/qty';
	import PublicDisplayHint from './public-display-hint.svelte';

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
			description: string;
		}) => void;
	}

	let { item, itemId, onclose, onsubmit }: Props = $props();

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
	let selectedUnitOption = $state(
		STANDARD_UNITS.includes(editedNeed?.unit ?? '') ? (editedNeed?.unit as string) : 'custom'
	);
	let customUnit = $state(
		STANDARD_UNITS.includes(editedNeed?.unit ?? '') ? '' : (editedNeed?.unit ?? 'ชิ้น')
	);
	let targetQty = $state(editedNeed?.target ?? '0');
	let urgency = $state<'critical' | 'important' | 'normal'>(seed.notes.urgency);
	let description = $state(seed.notes.description ?? '');

	// What donors already pledged against this need. Read-only: it is derived from
	// donation docs, and lowering the target below it is what Force Cut-off is for.
	const pledged = roundQty(editedNeed?.reserved ?? '0');

	const URGENCY_OPTIONS = [
		{ value: 'normal', label: 'ปกติ (Normal)' },
		{ value: 'important', label: 'สำคัญ (Important)' },
		{ value: 'critical', label: 'วิกฤต (Critical)' }
	] as const;

	const finalUnit = $derived(
		selectedUnitOption === 'custom' ? customUnit.trim() : selectedUnitOption
	);
	const unitLabel = $derived(
		selectedUnitOption === 'custom' ? 'ระบุหน่วยเอง (Custom)...' : selectedUnitOption
	);
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

		onsubmit({
			title: campaignTitle.trim(),
			category: category.trim(),
			unit: finalUnit,
			target: persistQty(targetQty),
			urgency,
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
				<Label for="edit-item-unit" class="mb-1.5 text-xs font-bold text-foreground">
					หน่วย (Unit)
				</Label>
				<div class="space-y-2">
					<Select.Root type="single" bind:value={selectedUnitOption}>
						<Select.Trigger
							id="edit-item-unit"
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
						<Input
							type="text"
							placeholder="พิมพ์ระบุหน่วย..."
							bind:value={customUnit}
							class="h-10 rounded-xl text-xs"
						/>
					{/if}
				</div>
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
					{finalUnit || editedNeed?.unit || ''} — ตั้งเป้าต่ำกว่ายอดจองจะทำให้รายการนี้ปิดรับทันที
				</p>
			</div>
		</div>

		<PublicDisplayHint {itemId} typedUnit={finalUnit} />

		<!-- Row 3: Urgency Level -->
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
