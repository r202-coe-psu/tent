<script lang="ts">
	import { page } from '$app/state';
	import {
		applyItemOp,
		masterTypeSchema,
		type MasterDataItem,
		type MasterDataType
	} from '$lib/features/master-data';
	import { useMasterData, useMasterDataList, usePutMaster } from '$lib/features/master-data';
	import MasterDataTypeList from './master-data-type-list.svelte';
	import MasterDataItemList from './master-data-item-list.svelte';
	import MasterDataEditModal from './master-data-edit-modal.svelte';

	// Active type lives in the URL (`?type=...`) — single source of truth so
	// the left-column tabs act as deep links, browser back/forward work, and
	// `MasterDataTypeList` can render real `<a href>` anchors.
	const activeType = $derived<MasterDataType>(parseActiveType());

	function parseActiveType(): MasterDataType {
		const raw = page.url.searchParams.get('type');
		const parsed = masterTypeSchema.safeParse(raw);
		return parsed.success ? parsed.data : 'vulnerable_group';
	}

	const list = useMasterDataList();
	const detail = useMasterData(() => activeType);
	const putMutation = usePutMaster();

	let modalOpen = $state(false);
	let editingItem = $state<MasterDataItem | null>(null);

	const items = $derived(detail.data?.items ?? []);

	const counts = $derived(
		Object.fromEntries((list.data ?? []).map((m) => [m.master_type, m.items.length])) as Partial<
			Record<MasterDataType, number>
		>
	);

	function openAdd() {
		editingItem = null;
		modalOpen = true;
	}

	function openEdit(item: MasterDataItem) {
		editingItem = item;
		modalOpen = true;
	}

	function handleSubmit(input: { code?: string; label: string; is_default: boolean }) {
		const op = input.code
			? ({
					kind: 'edit',
					code: input.code,
					label: input.label,
					is_default: input.is_default
				} as const)
			: ({ kind: 'add', label: input.label, is_default: input.is_default } as const);
		putMutation.mutate({ type: activeType, items: applyItemOp(items, op) });
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">ตั้งค่าการลงทะเบียน</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			จัดการค่ามาตรฐานสำหรับฟอร์มลงทะเบียน — เพิ่ม แก้ไข หรือลบตัวเลือกที่ใช้ในแต่ละหมวดหมู่ (Phase
			1: จัดการเท่านั้น ยังไม่ผูกกับฟอร์ม)
		</p>
	</header>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:gap-6">
		<MasterDataTypeList {activeType} {counts} />
		<MasterDataItemList type={activeType} {items} onAdd={openAdd} onEdit={openEdit} />
	</div>
</div>

<MasterDataEditModal
	bind:open={modalOpen}
	masterType={activeType}
	editing={editingItem}
	onSubmit={handleSubmit}
/>
