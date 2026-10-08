<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Power from '@lucide/svelte/icons/power';
	import Ban from '@lucide/svelte/icons/ban';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import type { ItemMaster } from '../../domain/catalog';
	import ItemMasterForm from '../item-master-form.svelte';
	import MasterBadge from './master-badge.svelte';
	import {
		ORIGIN_LABELS,
		ORIGIN_TONES,
		type CatalogOriginKey,
		type ItemSheetAction,
		type ItemSheetMode
	} from './master-view';

	let {
		open = $bindable(false),
		mode = $bindable('view'),
		item,
		origin,
		action,
		canEdit,
		categoryLabel,
		unitLines,
		basePath,
		defaultCategoryId,
		onaction,
		onactivate,
		onmerge,
		onclose
	}: {
		open?: boolean;
		mode?: ItemSheetMode;
		item: ItemMaster | null;
		origin: CatalogOriginKey;
		action: ItemSheetAction;
		canEdit: boolean;
		categoryLabel: string;
		unitLines: string[];
		basePath: string;
		defaultCategoryId?: string;
		/** Ask the panel to confirm delete / reset / deactivate. */
		onaction: (kind: 'delete' | 'reset' | 'deactivate') => void;
		onactivate: () => void;
		/** Offer "รวมกับรายการอื่น" (CR-143 §F); the panel passes it only when the actor may merge this item. */
		onmerge?: () => void;
		/** The sheet closed after a create, so the panel can clear its selection. */
		onclose: () => void;
	} = $props();

	const TYPE_LABELS: Record<string, string> = {
		CONSUMABLE: 'วัสดุสิ้นเปลือง',
		DURABLE: 'สิ่งของคงทน',
		EQUIPMENT: 'อุปกรณ์'
	};
	const STORAGE_LABELS: Record<string, string> = {
		DRY: 'ของแห้ง',
		CHILLED: 'แช่เย็น',
		FROZEN: 'แช่แข็ง',
		CONTROLLED_MED: 'ควบคุมพิเศษ/ยา'
	};
	const GENDER_LABELS: Record<string, string> = { ALL: 'ทุกเพศ', MALE: 'ชาย', FEMALE: 'หญิง' };
	const AGE_LABELS: Record<string, string> = {
		ALL: 'ทุกวัย',
		INFANT: 'ทารก',
		CHILD: 'เด็ก',
		ELDERLY: 'ผู้สูงอายุ'
	};
	const DIETARY_LABELS: Record<string, string> = { HALAL: 'ฮาลาล', VEGAN: 'วีแกน' };
	const DISTRIBUTION_LABELS: Record<string, string> = {
		recurring: 'แจกซ้ำได้ตามรอบ',
		one_time: 'แจกครั้งเดียวต่อคน'
	};
	const ASSET_LABELS: Record<string, string> = {
		READY: 'พร้อมใช้งาน',
		IN_USE: 'กำลังใช้งาน',
		MAINTENANCE: 'บำรุงรักษา',
		BROKEN: 'ชำรุด'
	};

	type Row = { label: string; value: string | null; multiline?: boolean };
	type Group = { title: string; rows: Row[] };

	const groups = $derived.by<Group[]>(() => {
		if (!item) return [];
		const dietary = (item.dietary ?? []).map((d) => DIETARY_LABELS[d] ?? d).join(', ');
		const result: Group[] = [
			{
				title: 'ทั่วไป',
				rows: [
					{ label: 'รหัสสินค้า (SKU)', value: item.sku || null },
					{ label: 'หมวดหมู่', value: categoryLabel || null },
					{ label: 'ประเภท', value: TYPE_LABELS[item.type_class] ?? item.type_class },
					{ label: 'รายละเอียด', value: item.description || null }
				]
			},
			{
				title: 'หน่วย',
				rows: [
					{ label: 'หน่วยและการแปลง', value: unitLines.join('\n'), multiline: true },
					{ label: 'หน่วยรับเข้าเริ่มต้น', value: item.default_inventory_uom || null },
					{ label: 'หน่วยเบิกเริ่มต้น', value: item.default_issue_uom || null }
				]
			},
			{
				title: 'การเก็บรักษาและกลุ่มผู้รับ',
				rows: [
					{
						label: 'ประเภทการจัดเก็บ',
						value: item.storage_type
							? (STORAGE_LABELS[item.storage_type] ?? item.storage_type)
							: null
					},
					{
						label: 'อายุการเก็บรักษา',
						value: item.shelf_life_days != null ? `${item.shelf_life_days} วัน` : null
					},
					{ label: 'สารก่อภูมิแพ้', value: item.allergens || null },
					{
						label: 'เพศที่ใช้ได้',
						value: item.target_gender
							? (GENDER_LABELS[item.target_gender] ?? item.target_gender)
							: null
					},
					{
						label: 'ช่วงวัย',
						value: item.age_group ? (AGE_LABELS[item.age_group] ?? item.age_group) : null
					},
					{ label: 'ข้อจำกัดด้านอาหาร', value: dietary || null },
					{
						label: 'รูปแบบการแจก',
						value: item.distribution_type
							? (DISTRIBUTION_LABELS[item.distribution_type] ?? item.distribution_type)
							: null
					}
				]
			}
		];
		if (item.type_class !== 'CONSUMABLE') {
			result.push({
				title: 'สิ่งของคงทน / อุปกรณ์',
				rows: [
					{
						label: 'จำนวนต่อคน',
						value: item.qty_per_person != null ? String(item.qty_per_person) : null
					},
					{ label: 'ต้องคืน', value: item.returnable ? 'ต้องคืน' : 'ไม่ต้องคืน' },
					{
						label: 'สถานะ',
						value: item.asset_status ? (ASSET_LABELS[item.asset_status] ?? item.asset_status) : null
					}
				]
			});
		}
		return result;
	});

	function afterForm() {
		if (mode === 'create') {
			open = false;
			onclose();
		} else {
			mode = 'view';
		}
	}

	const title = $derived(
		mode === 'create' ? 'เพิ่มสินค้า' : mode === 'edit' ? 'แก้ไขสินค้า' : (item?.name ?? 'สินค้า')
	);
</script>

<Sheet.Root bind:open onOpenChange={(v) => !v && onclose()}>
	<Sheet.Content
		side="right"
		class="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none md:w-[36rem] md:border-l"
	>
		{#if mode === 'view' && item}
			<Sheet.Header class="shrink-0 space-y-3 border-b border-slate-200/80 p-4 pr-12 text-left">
				<div>
					<p class="text-sm text-slate-500">
						{#if item.sku}SKU {item.sku} ·
						{/if}{categoryLabel || 'ไม่ระบุหมวด'}
					</p>
					<Sheet.Title class="mt-0.5 text-xl font-bold text-slate-900">{item.name}</Sheet.Title>
					<Sheet.Description class="sr-only"
						>รายละเอียดและการจัดการสินค้า {item.name}</Sheet.Description
					>
				</div>
				<div class="flex flex-wrap gap-1.5">
					<MasterBadge tone={ORIGIN_TONES[origin]}>{ORIGIN_LABELS[origin]}</MasterBadge>
					<MasterBadge tone={item.deactivated ? 'red' : 'green'}>
						{item.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
					</MasterBadge>
				</div>

				{#if canEdit || action !== 'none'}
					<div class="grid grid-cols-2 gap-2">
						{#if canEdit}
							<Button
								type="button"
								class="min-h-11 gap-1.5 rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
								onclick={() => (mode = 'edit')}
							>
								<Pencil class="h-4 w-4" aria-hidden="true" />
								แก้ไข
							</Button>
						{/if}
						{#if action === 'delete'}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 gap-1.5 rounded-lg border-red-200 text-sm font-semibold text-red-800"
								onclick={() => onaction('delete')}
							>
								<Ban class="h-4 w-4" aria-hidden="true" />
								ปิดใช้งาน
							</Button>
						{:else if action === 'reset'}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 gap-1.5 rounded-lg border-amber-200 text-sm font-semibold text-amber-900"
								onclick={() => onaction('reset')}
							>
								<RotateCcw class="h-4 w-4" aria-hidden="true" />
								คืนค่ามาตรฐาน
							</Button>
						{:else if action === 'toggle'}
							{#if item.deactivated}
								<Button
									type="button"
									variant="outline"
									class="min-h-11 gap-1.5 rounded-lg border-emerald-200 text-sm font-semibold text-emerald-900"
									onclick={onactivate}
								>
									<Power class="h-4 w-4" aria-hidden="true" />
									เปิดใช้งาน
								</Button>
							{:else}
								<Button
									type="button"
									variant="outline"
									class="min-h-11 gap-1.5 rounded-lg border-red-200 text-sm font-semibold text-red-800"
									onclick={() => onaction('deactivate')}
								>
									<Ban class="h-4 w-4" aria-hidden="true" />
									ปิดใช้งาน
								</Button>
							{/if}
						{/if}
					</div>
				{/if}
				{#if onmerge}
					<Button
						type="button"
						variant="outline"
						class="min-h-11 w-full gap-1.5 rounded-lg border-slate-300 text-sm font-semibold text-slate-800"
						onclick={onmerge}
					>
						<GitMerge class="h-4 w-4" aria-hidden="true" />
						รวมกับรายการอื่น
					</Button>
				{/if}
				{#if action === 'central'}
					<p
						class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
					>
						สินค้านี้เป็นของส่วนกลาง จัดการได้ที่ส่วนกลาง
					</p>
				{/if}
			</Sheet.Header>

			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
				{#each groups as group (group.title)}
					<section>
						<h3 class="mb-2 text-sm font-bold text-slate-600">{group.title}</h3>
						<dl class="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
							{#each group.rows as row (row.label)}
								<div class="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-3.5 py-2.5 text-sm">
									<dt class="text-slate-500">{row.label}</dt>
									<dd
										class="font-semibold {row.value
											? 'text-slate-900'
											: 'text-amber-800'} {row.multiline
											? 'leading-relaxed whitespace-pre-line'
											: 'break-words'}"
									>
										{row.value ?? 'ยังไม่ระบุ'}
									</dd>
								</div>
							{/each}
						</dl>
					</section>
				{/each}
			</div>
		{:else if mode === 'edit' || mode === 'create'}
			<Sheet.Header class="shrink-0 border-b border-slate-200/80 p-4 pr-12 text-left">
				{#if mode === 'edit'}
					<Button
						type="button"
						variant="ghost"
						class="mb-1 -ml-2 min-h-11 w-fit gap-1.5 px-2 text-sm font-semibold text-sky-800"
						onclick={() => (mode = 'view')}
					>
						<ArrowLeft class="h-4 w-4" aria-hidden="true" />
						กลับไปรายละเอียด
					</Button>
				{/if}
				<Sheet.Title class="text-xl font-bold text-slate-900">{title}</Sheet.Title>
				<Sheet.Description class="text-sm text-slate-500">
					{mode === 'edit' ? (item?.name ?? '') : categoryLabel || 'รายการสินค้า'}
				</Sheet.Description>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				{#key `${mode}-${item?._id ?? ''}`}
					<ItemMasterForm
						id={mode === 'edit' ? (item?._id ?? '') : ''}
						isEdit={mode === 'edit'}
						{basePath}
						compact={true}
						{defaultCategoryId}
						onsuccess={afterForm}
					/>
				{/key}
			</div>
		{:else}
			<Sheet.Title class="sr-only">สินค้า</Sheet.Title>
			<Sheet.Description class="sr-only">ไม่พบสินค้าที่เลือก</Sheet.Description>
		{/if}
	</Sheet.Content>
</Sheet.Root>
