<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		dedupeItemsByCode,
		duplicateItemCodes,
		duplicateLabelKeys,
		formatMasterLabel,
		labelCollisionKey,
		MASTER_DATA_TYPE_META,
		type MasterDataItem,
		type MasterDataItemSource,
		type MasterDataQueryContext,
		type MasterDataType
	} from '$lib/features/master-data';
	import { langState } from '$lib/states/i18n.svelte';

	let {
		type,
		items,
		context,
		itemSources,
		onAdd,
		onEdit,
		onToggleStatus,
		onSetGlobalDefault
	}: {
		type: MasterDataType;
		items: readonly MasterDataItem[];
		context?: MasterDataQueryContext;
		itemSources?: Record<string, MasterDataItemSource>;
		onAdd: () => void;
		onEdit: (item: MasterDataItem) => void;
		onToggleStatus: (item: MasterDataItem) => void;
		onSetGlobalDefault: (item: MasterDataItem) => void;
	} = $props();

	let search = $state('');
	let categoryFilter = $state<'all' | 'operational' | 'controlled'>('all');
	let statusFilter = $state<'all' | 'active' | 'inactive'>('all');

	const meta = $derived(MASTER_DATA_TYPE_META[type]);
	const isVolunteer = $derived(type === 'volunteer_skills');
	const isShelterScope = $derived(context?.scope === 'shelter');

	// Reset search/filters only when the hub switches type (not on every render).
	let previousType: MasterDataType | undefined;
	$effect(() => {
		const current = type;
		if (previousType !== undefined && previousType !== current) {
			search = '';
			categoryFilter = 'all';
			statusFilter = 'all';
		}
		previousType = current;
	});

	const filtered = $derived(
		items.filter((item) => {
			if (isVolunteer) {
				const category = normalizeCategory(item.category);
				if (categoryFilter === 'operational' && category !== 'operational') return false;
				if (categoryFilter === 'controlled' && category !== 'controlled') return false;
			}
			if (statusFilter === 'active' && item.status !== 'active') return false;
			if (statusFilter === 'inactive' && item.status !== 'inactive') return false;

			const q = search.trim().toLowerCase();
			if (!q) return true;
			const matchTh = item.label_th.toLowerCase().includes(q);
			const matchEn = item.label_en.toLowerCase().includes(q);
			const matchCode = item.code.toLowerCase().includes(q);
			const matchDesc = item.description?.toLowerCase().includes(q) ?? false;
			return matchTh || matchEn || matchCode || (isVolunteer && matchDesc);
		})
	);

	const distinctItems = $derived(dedupeItemsByCode(items));
	const duplicateKeys = $derived(duplicateLabelKeys(distinctItems));
	const duplicateCount = $derived(
		distinctItems.filter(
			(i) =>
				duplicateKeys.has(labelCollisionKey('label_th', i.label_th)) ||
				duplicateKeys.has(labelCollisionKey('label_en', i.label_en))
		).length
	);
	const duplicateCodes = $derived(duplicateItemCodes(items));
	const displayLang = $derived(langState.current);

	function normalizeCategory(
		category: MasterDataItem['category'] | undefined
	): 'operational' | 'controlled' {
		if (category === 'controlled' || category === 'CONTROLLED') return 'controlled';
		return 'operational';
	}

	function categoryLabel(category: MasterDataItem['category'] | undefined): string {
		return normalizeCategory(category) === 'controlled' ? 'ควบคุมพิเศษ' : 'ภาคสนาม';
	}

	function isDuplicate(item: MasterDataItem): boolean {
		return (
			duplicateKeys.has(labelCollisionKey('label_th', item.label_th)) ||
			duplicateKeys.has(labelCollisionKey('label_en', item.label_en))
		);
	}

	function itemDisplayLabel(item: MasterDataItem): string {
		return formatMasterLabel(item, displayLang);
	}

	function isOwned(item: MasterDataItem): boolean {
		if (!isShelterScope) return true;
		return itemSources?.[item.code]?.scope === 'shelter';
	}

	function canPerShelterToggle(item: MasterDataItem): boolean {
		if (!isShelterScope) return false;
		const source = itemSources?.[item.code];
		if (source?.scope !== 'global') return false;
		return source.shelter_disabled === true || item.status === 'active';
	}

	function canSetGlobalDefault(item: MasterDataItem): boolean {
		if (!isShelterScope) return false;
		if (item.status !== 'active' || item.is_default) return false;
		return itemSources?.[item.code]?.scope === 'global';
	}

	function clearSearch() {
		search = '';
	}
</script>

<section
	class="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6"
	aria-label="รายการข้อมูล"
	data-master-type={type}
>
	<header class="space-y-1">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-lg font-bold text-slate-900">{meta.title}</h2>
			<span
				class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600 tabular-nums"
			>
				{items.length} รายการ
			</span>
			{#if isShelterScope}
				<span
					class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
				>
					ศูนย์นี้
				</span>
			{:else}
				<span
					class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600"
				>
					ส่วนกลาง
				</span>
			{/if}
		</div>
		<p class="text-sm text-slate-500">{meta.description}</p>
	</header>

	<div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
		<p class="text-sm font-semibold text-slate-800">มีผลต่อฟอร์มไหนบ้าง</p>
		<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
			{#each meta.affectedForms as form (form)}
				<li>{form}</li>
			{/each}
		</ul>
	</div>

	{#if duplicateCount > 0}
		<div role="alert" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
			<p class="font-medium text-amber-900">พบชื่อซ้ำ {duplicateCount} รายการในประเภทนี้</p>
			<p class="mt-1 text-slate-600">
				กรุณาแก้ไขชื่อหรือปิดใช้งานให้เหลือรายการเดียวต่อหนึ่งชื่อ{isShelterScope
					? ' (รายการส่วนกลางต้องแก้ที่ส่วนกลาง)'
					: ''}
			</p>
		</div>
	{/if}

	{#if duplicateCodes.size > 0}
		<div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
			<p class="font-medium text-red-900">พบรายการที่มีรหัสซ้ำกัน {duplicateCodes.size} รหัส</p>
			<p class="mt-1 text-slate-600">ระบบจะยุบให้เหลือรายการเดียวอัตโนมัติเมื่อบันทึกครั้งถัดไป</p>
		</div>
	{/if}

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="relative w-full sm:max-w-sm sm:flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
			/>
			<Input
				bind:value={search}
				type="search"
				placeholder="ค้นหาชื่อหรือรหัส…"
				class="h-11 pl-9"
				aria-label="ค้นหาชื่อหรือรหัส"
			/>
		</div>
		<Button
			type="button"
			onclick={onAdd}
			class="h-11 min-h-11 shrink-0 bg-[#0A2647] text-white hover:bg-[#051930]"
		>
			<Plus class="mr-1 h-4 w-4" aria-hidden="true" />
			เพิ่มรายการ
		</Button>
	</div>

	{#if isVolunteer}
		<div class="flex flex-wrap gap-2" role="group" aria-label="ตัวกรองทักษะอาสา">
			{#each [{ id: 'all', label: 'ทั้งหมด' }, { id: 'operational', label: 'ภาคสนาม' }, { id: 'controlled', label: 'ควบคุมพิเศษ' }] as chip (chip.id)}
				<button
					type="button"
					class="inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{categoryFilter === chip.id
						? 'border-sky-200 bg-sky-50 text-sky-900'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					aria-pressed={categoryFilter === chip.id}
					onclick={() => (categoryFilter = chip.id as typeof categoryFilter)}
				>
					{chip.label}
				</button>
			{/each}
			<span class="mx-1 hidden h-8 w-px self-center bg-slate-200 sm:inline-block" aria-hidden="true"
			></span>
			{#each [{ id: 'active', label: 'ใช้งาน' }, { id: 'inactive', label: 'ปิดใช้' }] as chip (chip.id)}
				<button
					type="button"
					class="inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{statusFilter === chip.id
						? 'border-sky-200 bg-sky-50 text-sky-900'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					aria-pressed={statusFilter === chip.id}
					onclick={() =>
						(statusFilter = statusFilter === chip.id ? 'all' : (chip.id as 'active' | 'inactive'))}
				>
					{chip.label}
				</button>
			{/each}
		</div>
	{/if}

	<div class="space-y-2">
		{#each filtered as item, i (duplicateCodes.has(item.code) ? `${item.code}#${i}` : item.code)}
			{@const source = itemSources?.[item.code]}
			{@const owned = isOwned(item)}
			{@const perShelter = !owned && canPerShelterToggle(item)}
			{@const canSetDefault = !owned && canSetGlobalDefault(item)}
			<div
				class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition hover:border-slate-300
					{item.status === 'inactive' ? 'opacity-70' : ''}"
			>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<button
						type="button"
						class="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
						onclick={() => owned && onEdit(item)}
						disabled={!owned}
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-semibold text-slate-900">{itemDisplayLabel(item)}</span>
							{#if item.status === 'active'}
								<span
									class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900"
								>
									ใช้งาน
								</span>
							{:else if source?.shelter_disabled}
								<span
									class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600"
								>
									ปิดใช้ (ศูนย์นี้)
								</span>
							{:else}
								<span
									class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600"
								>
									ปิดใช้
								</span>
							{/if}
							{#if item.is_default}
								<span
									class="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
								>
									ค่าเริ่มต้น
								</span>
							{/if}
							{#if source?.scope === 'global' && isShelterScope}
								<span
									class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600"
								>
									ส่วนกลาง
								</span>
							{/if}
							{#if source?.scope === 'shelter'}
								<span
									class="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
								>
									ศูนย์นี้
								</span>
							{/if}
							{#if isVolunteer}
								<span
									class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900"
								>
									{categoryLabel(item.category)}
								</span>
							{/if}
							{#if isDuplicate(item)}
								<Badge variant="destructive">ชื่อซ้ำ</Badge>
							{/if}
							{#if duplicateCodes.has(item.code)}
								<Badge variant="destructive">รหัสซ้ำ</Badge>
							{/if}
						</div>
						<div class="mt-1 text-xs text-slate-500">
							<span class="tabular-nums">{item.code}</span>
							{#if item.description}
								<span aria-hidden="true"> · </span>
								<span class="line-clamp-1">{item.description}</span>
							{/if}
						</div>
					</button>

					<div class="flex flex-wrap items-center gap-2 sm:justify-end">
						{#if owned}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="min-h-11 border-slate-200"
								onclick={() => onEdit(item)}
								aria-label="แก้ไข {itemDisplayLabel(item)}"
							>
								แก้ไข
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="min-h-11 {item.status === 'active'
									? 'border-red-200 text-red-700 hover:bg-red-50'
									: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}"
								onclick={() => onToggleStatus(item)}
								aria-label="{item.status === 'active' ? 'ปิดใช้' : 'ใช้งาน'} {itemDisplayLabel(
									item
								)}"
							>
								{item.status === 'active' ? 'ปิดใช้' : 'ใช้งาน'}
							</Button>
						{:else if perShelter}
							{#if canSetDefault}
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="min-h-11 border-sky-200 text-sky-900 hover:bg-sky-50"
									onclick={() => onSetGlobalDefault(item)}
									aria-label="ตั้งเป็นค่าเริ่มต้น {itemDisplayLabel(item)}"
								>
									ตั้งเป็นค่าเริ่มต้น
								</Button>
							{/if}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="min-h-11 {source?.shelter_disabled
									? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
									: 'border-red-200 text-red-700 hover:bg-red-50'}"
								onclick={() => onToggleStatus(item)}
								aria-label="{source?.shelter_disabled
									? 'เปิดใช้งานสำหรับศูนย์นี้'
									: 'ปิดใช้งานสำหรับศูนย์นี้'} {itemDisplayLabel(item)}"
							>
								{source?.shelter_disabled ? 'เปิดใช้ (ศูนย์นี้)' : 'ปิดใช้ (ศูนย์นี้)'}
							</Button>
						{:else}
							<span class="text-xs text-slate-500">จัดการที่ส่วนกลาง</span>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div
				class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center"
			>
				{#if search.trim() || (isVolunteer && (categoryFilter !== 'all' || statusFilter !== 'all'))}
					<p class="text-sm font-medium text-slate-700">ไม่พบรายการ</p>
					<p class="mt-1 text-sm text-slate-500">ลองเปลี่ยนคำค้นหาหรือตัวกรอง</p>
					{#if search.trim()}
						<Button type="button" variant="outline" class="mt-4 min-h-11" onclick={clearSearch}>
							ล้างค้นหา
						</Button>
					{/if}
				{:else}
					<p class="text-sm font-medium text-slate-700">ยังไม่มีรายการ</p>
					<p class="mt-1 text-sm text-slate-500">เพิ่มรายการแรกเพื่อเริ่มใช้งานประเภทนี้</p>
					<Button
						type="button"
						class="mt-4 min-h-11 bg-[#0A2647] text-white hover:bg-[#051930]"
						onclick={onAdd}
					>
						<Plus class="mr-1 h-4 w-4" aria-hidden="true" />
						เพิ่มรายการ
					</Button>
				{/if}
			</div>
		{/each}
	</div>
</section>
