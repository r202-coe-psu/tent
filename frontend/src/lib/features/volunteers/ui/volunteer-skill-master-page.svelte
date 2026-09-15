<script lang="ts">
	import { useMasterData, usePutMaster, type MasterDataItem } from '$lib/features/master-data';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import VolunteerSkillStats from './volunteer-skill-stats.svelte';
	import VolunteerSkillTable from './volunteer-skill-table.svelte';
	import VolunteerSkillEditDialog from './volunteer-skill-edit-dialog.svelte';
	import VolunteerSkillDeleteDialog from './volunteer-skill-delete-dialog.svelte';
	import VolunteerSkillToggleDialog from './volunteer-skill-toggle-dialog.svelte';

	let {
		scope = 'global'
	}: {
		scope?: 'global' | 'shelter' | 'effective';
	} = $props();

	const masterQuery = useMasterData(
		() => 'volunteer_skills',
		() => ({ scope })
	);
	const putMutation = usePutMaster();

	const rawItems = $derived<MasterDataItem[]>(masterQuery.data?.items ?? []);

	// Filters & Search
	let searchQuery = $state('');
	let selectedTypeFilter = $state<'all' | 'operational' | 'controlled'>('all');
	let selectedStatusFilter = $state<'all' | 'active' | 'inactive'>('all');

	// Stats
	const totalCount = $derived(rawItems.length);
	const operationalCount = $derived(
		rawItems.filter((i) => (i.category ?? 'operational') === 'operational').length
	);
	const controlledCount = $derived(rawItems.filter((i) => i.category === 'controlled').length);
	const activeCount = $derived(rawItems.filter((i) => i.status !== 'inactive').length);

	// Filtered list
	const filteredItems = $derived(
		rawItems.filter((item) => {
			const category = item.category ?? 'operational';
			if (selectedTypeFilter === 'operational' && category !== 'operational') return false;
			if (selectedTypeFilter === 'controlled' && category !== 'controlled') return false;

			const status = item.status ?? 'active';
			if (selectedStatusFilter === 'active' && status !== 'active') return false;
			if (selectedStatusFilter === 'inactive' && status !== 'inactive') return false;

			if (searchQuery.trim()) {
				const query = searchQuery.toLowerCase().trim();
				const matchCode = item.code.toLowerCase().includes(query);
				const matchLabel = item.label.toLowerCase().includes(query);
				const matchDesc = item.description?.toLowerCase().includes(query) ?? false;
				return matchCode || matchLabel || matchDesc;
			}
			return true;
		})
	);

	// Add/Edit Modal State
	let isModalOpen = $state(false);
	let editingItem = $state<MasterDataItem | null>(null);

	// Delete Confirmation Modal State
	let isDeleteModalOpen = $state(false);
	let itemToDelete = $state<MasterDataItem | null>(null);

	// Status Toggle Confirmation Modal State
	let isStatusModalOpen = $state(false);
	let itemToToggleStatus = $state<MasterDataItem | null>(null);

	function openAddModal() {
		editingItem = null;
		isModalOpen = true;
	}

	function openEditModal(item: MasterDataItem) {
		editingItem = item;
		isModalOpen = true;
	}

	function promptDelete(item: MasterDataItem) {
		itemToDelete = item;
		isDeleteModalOpen = true;
	}

	function promptToggleStatus(item: MasterDataItem) {
		itemToToggleStatus = item;
		isStatusModalOpen = true;
	}

	async function saveItems(items: MasterDataItem[]) {
		await putMutation.mutateAsync({
			type: 'volunteer_skills',
			items,
			context: { scope }
		});
	}

	async function handleSaveSkill(data: {
		code: string;
		label: string;
		category: 'operational' | 'controlled';
		description: string;
		is_default: boolean;
	}) {
		let nextItems: MasterDataItem[];

		if (editingItem) {
			nextItems = rawItems.map((item) => {
				if (item.code === editingItem?.code) {
					return {
						...item,
						code: data.code,
						label: data.label,
						category: data.category,
						description: data.description,
						is_default: data.is_default ? true : item.is_default
					};
				}
				if (data.is_default) {
					return { ...item, is_default: false };
				}
				return item;
			});
		} else {
			const newItem: MasterDataItem = {
				code: data.code,
				label: data.label,
				category: data.category,
				description: data.description,
				is_default: data.is_default,
				status: 'active'
			};
			if (data.is_default) {
				nextItems = [...rawItems.map((i) => ({ ...i, is_default: false })), newItem];
			} else {
				nextItems = [...rawItems, newItem];
			}
		}

		await saveItems(nextItems);
		isModalOpen = false;
	}

	async function handleConfirmDelete() {
		if (!itemToDelete) return;
		const nextItems = rawItems.filter((i) => i.code !== itemToDelete?.code);
		await saveItems(nextItems);
		isDeleteModalOpen = false;
		itemToDelete = null;
	}

	async function handleConfirmToggleStatus() {
		if (!itemToToggleStatus) return;
		const targetCode = itemToToggleStatus.code;
		const isCurrentlyActive = itemToToggleStatus.status !== 'inactive';
		const nextStatus: 'active' | 'inactive' = isCurrentlyActive ? 'inactive' : 'active';

		const nextItems = rawItems.map((i) =>
			i.code === targetCode ? { ...i, status: nextStatus } : i
		);
		await saveItems(nextItems);
		isStatusModalOpen = false;
		itemToToggleStatus = null;
	}

	async function handleSetDefault(item: MasterDataItem) {
		if (item.is_default) return;
		const nextItems = rawItems.map((i) => ({
			...i,
			is_default: i.code === item.code
		}));
		await saveItems(nextItems);
	}
</script>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
	<!-- Header Section -->
	<header
		class="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-center"
	>
		<div>
			<div
				class="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
			>
				<Users class="h-3.5 w-3.5" />
				<span>ระบบตั้งค่าส่วนกลาง (Central System Management)</span>
			</div>
			<h1 class="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
				4. ตั้งค่าทักษะมาตรฐานจิตอาสา (Volunteer Skills)
			</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				กำหนดค่ามาตรฐานทักษะความสามารถสำหรับงานอาสาสมัครในระบบ — แบ่งประเภททักษะทั่วไป (Operational)
				และทักษะวิชาชีพควบคุม (Controlled) ที่บันทึกลง CouchDB
			</p>
		</div>

		<div class="flex items-center gap-3">
			<Button
				type="button"
				onclick={openAddModal}
				class="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-xs hover:bg-primary-strong"
			>
				<Plus class="h-4 w-4" />
				เพิ่มทักษะมาตรฐานใหม่
			</Button>
		</div>
	</header>

	<!-- Stat Cards Subcomponent -->
	<VolunteerSkillStats {totalCount} {operationalCount} {controlledCount} {activeCount} />

	<!-- Filter & Search Bar -->
	<div
		class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="relative flex-1">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="text"
				bind:value={searchQuery}
				placeholder="ค้นหารหัสทักษะ (Key), ชื่อทักษะ หรือคำอธิบาย..."
				class="w-full rounded-xl border-border bg-background py-2 pr-4 pl-9 text-xs focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<!-- Category Filter -->
			<div class="flex rounded-xl border border-border bg-muted/40 p-0.5 text-xs">
				<button
					type="button"
					onclick={() => (selectedTypeFilter = 'all')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedTypeFilter ===
					'all'
						? 'bg-card font-bold text-foreground shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					ทั้งหมด ({totalCount})
				</button>
				<button
					type="button"
					onclick={() => (selectedTypeFilter = 'operational')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedTypeFilter ===
					'operational'
						? 'bg-card font-bold text-success shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					ทั่วไป ({operationalCount})
				</button>
				<button
					type="button"
					onclick={() => (selectedTypeFilter = 'controlled')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedTypeFilter ===
					'controlled'
						? 'bg-card font-bold text-warning-foreground shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					ควบคุม ({controlledCount})
				</button>
			</div>

			<!-- Status Filter -->
			<div class="flex rounded-xl border border-border bg-muted/40 p-0.5 text-xs">
				<button
					type="button"
					onclick={() => (selectedStatusFilter = 'all')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedStatusFilter ===
					'all'
						? 'bg-card font-bold text-foreground shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					ทุกสถานะ
				</button>
				<button
					type="button"
					onclick={() => (selectedStatusFilter = 'active')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedStatusFilter ===
					'active'
						? 'bg-card font-bold text-primary shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					เปิดใช้งาน ({activeCount})
				</button>
				<button
					type="button"
					onclick={() => (selectedStatusFilter = 'inactive')}
					class="cursor-pointer rounded-lg px-2.5 py-1.5 font-medium transition-all {selectedStatusFilter ===
					'inactive'
						? 'bg-card font-bold text-foreground shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					ปิดใช้งาน ({totalCount - activeCount})
				</button>
			</div>
		</div>
	</div>

	<!-- Skills Table Subcomponent -->
	<VolunteerSkillTable
		items={filteredItems}
		onEdit={openEditModal}
		onSetDefault={handleSetDefault}
		onToggleStatus={promptToggleStatus}
		onDelete={promptDelete}
	/>
</div>

<!-- Add / Edit Modal Subcomponent -->
<VolunteerSkillEditDialog
	open={isModalOpen}
	{editingItem}
	existingItems={rawItems}
	isPending={putMutation.isPending}
	onClose={() => (isModalOpen = false)}
	onSave={handleSaveSkill}
/>

<!-- Delete Confirmation Modal Subcomponent -->
<VolunteerSkillDeleteDialog
	open={isDeleteModalOpen}
	item={itemToDelete}
	onClose={() => {
		isDeleteModalOpen = false;
		itemToDelete = null;
	}}
	onConfirm={handleConfirmDelete}
/>

<!-- Toggle Status Confirmation Modal Subcomponent -->
<VolunteerSkillToggleDialog
	open={isStatusModalOpen}
	item={itemToToggleStatus}
	onClose={() => {
		isStatusModalOpen = false;
		itemToToggleStatus = null;
	}}
	onConfirm={handleConfirmToggleStatus}
/>
