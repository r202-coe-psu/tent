<script lang="ts">
	import {
		useSupplyItems,
		useThresholdOverrides,
		useSaveThresholdOverride
	} from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { getShelterCode } from '$lib/db/shelter';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { SUPPLY_CATEGORY_LABELS, type SupplyCategory } from '$lib/features/supply';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Save from '@lucide/svelte/icons/save';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { toast } from 'svelte-sonner';

	// Queries
	const itemsQuery = useSupplyItems();
	const overridesQuery = useThresholdOverrides();
	const saveMutation = useSaveThresholdOverride();

	const items = $derived(itemsQuery.data ?? []);
	const overrides = $derived(overridesQuery.data ?? []);

	// Filter states
	let search = $state('');
	let categoryFilter = $state('all');

	// Local inputs state
	let editedLevels = $state<Record<string, string>>({});

	// Initialize inputs when data loads
	$effect(() => {
		if (overrides.length > 0) {
			for (const o of overrides) {
				if (o.reorder_level !== null) {
					editedLevels[o.item_id] = String(o.reorder_level);
				}
			}
		}
	});

	const uniqueCategories = $derived.by(() => {
		const cats = new SvelteSet<string>();
		for (const item of items) {
			if (item.category) cats.add(item.category);
		}
		return Array.from(cats).map((c) => ({
			value: c,
			label: SUPPLY_CATEGORY_LABELS[c as SupplyCategory] || c
		}));
	});

	const filteredItems = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return items.filter((item) => {
			if (q && !item.name.toLowerCase().includes(q) && !item._id.toLowerCase().includes(q)) {
				return false;
			}
			if (categoryFilter !== 'all' && item.category !== categoryFilter) {
				return false;
			}
			return true;
		});
	});

	function handleSave(itemId: string) {
		const rawVal = editedLevels[itemId];
		const shelterCode = getShelterCode();
		const val = rawVal === '' || rawVal === undefined ? null : Number(rawVal);

		if (val !== null && (Number.isNaN(val) || val < 0)) {
			toast.error('กรุณาระบุจำนวนเกณฑ์เตือนภัยเป็นตัวเลขที่ถูกต้อง');
			return;
		}

		saveMutation.mutate(
			{
				input: {
					_id: `stock_threshold_override:${shelterCode.toLowerCase()}:${itemId.replace('item:', '')}`,
					item_id: itemId,
					reorder_level: val,
					target_reserve_days: null,
					consumption_rate: null
				},
				ctx: {
					createdBy: authStore.user?.name ?? 'system',
					shelterCode
				}
			},
			{
				onSuccess: () => {
					toast.success('บันทึกเกณฑ์เตือนภัยเฉพาะศูนย์เรียบร้อยแล้ว');
				},
				onError: (err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					toast.error(`บันทึกไม่สำเร็จ: ${msg}`);
				}
			}
		);
	}

	function handleClear(itemId: string) {
		const shelterCode = getShelterCode();
		editedLevels[itemId] = '';

		saveMutation.mutate(
			{
				input: {
					_id: `stock_threshold_override:${shelterCode.toLowerCase()}:${itemId.replace('item:', '')}`,
					item_id: itemId,
					reorder_level: null,
					target_reserve_days: null,
					consumption_rate: null
				},
				ctx: {
					createdBy: authStore.user?.name ?? 'system',
					shelterCode
				}
			},
			{
				onSuccess: () => {
					toast.success('คืนค่าเกณฑ์เตือนภัยเป็นค่าเริ่มต้นของระบบแล้ว');
				},
				onError: (err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					toast.error(`คืนค่าไม่สำเร็จ: ${msg}`);
				}
			}
		);
	}
</script>

<section
	class="min-w-0 rounded-[24px] border border-border bg-card p-6 text-card-foreground shadow-md"
	aria-label="ตั้งค่าเกณฑ์เตือนภัยเฉพาะศูนย์"
>
	<header
		class="mb-6 flex flex-col gap-4 border-b border-border/60 pb-6 lg:flex-row lg:items-center lg:justify-between"
	>
		<div>
			<h2 class="text-xl font-bold">
				กำหนดเกณฑ์เตือนภัยคลังสินค้าเฉพาะศูนย์ ({filteredItems.length})
			</h2>
			<p class="mt-1.5 text-xs text-muted-foreground">
				ตั้งระดับจำนวนสินค้าคงเหลือขั้นต่ำเพื่อส่งสัญญาณเตือนภัยเมื่อของเหลือน้อย
				(ค่าที่ตั้งในหน้านี้จะเขียนทับค่ากลางของระบบสำหรับศูนย์อพยพนี้)
			</p>
		</div>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<!-- Search input -->
			<div class="relative w-full sm:w-60">
				<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={search}
					type="search"
					placeholder="ค้นหาชื่อสินค้า..."
					class="h-10 rounded-xl border border-border pl-9"
					aria-label="ค้นหาสินค้า"
				/>
			</div>
			<!-- Category filter -->
			<div class="relative w-full sm:w-48">
				<Filter
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<select
					bind:value={categoryFilter}
					class="h-10 w-full cursor-pointer appearance-none truncate rounded-xl border border-border bg-background pr-8 pl-9 text-sm font-semibold outline-none focus:border-primary"
				>
					<option value="all">ทุกหมวดหมู่</option>
					{#each uniqueCategories as cat (cat.value)}
						<option value={cat.value}>{cat.label}</option>
					{/each}
				</select>
				<div
					class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
				>
					<ChevronDown class="h-4 w-4" />
				</div>
			</div>
		</div>
	</header>

	{#if itemsQuery.isLoading || overridesQuery.isLoading}
		<div class="flex h-64 items-center justify-center">
			<div
				class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
			></div>
		</div>
	{:else if filteredItems.length === 0}
		<div
			class="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center"
		>
			<AlertTriangle class="mb-3 h-10 w-10 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">ไม่พบรายการพัสดุในระบบที่ตรงตามเงื่อนไข</p>
		</div>
	{:else}
		<div class="overflow-x-auto rounded-2xl border border-border/80 bg-background shadow-sm">
			<table class="w-full text-left text-xs whitespace-nowrap">
				<thead class="bg-muted/50 font-bold text-foreground">
					<tr class="border-b">
						<th class="p-4 pl-5">รายการสินค้า (SKU)</th>
						<th class="p-4 text-center">หมวดหมู่</th>
						<th class="p-4 text-center">หน่วยนับ</th>
						<th class="p-4 text-center">เกณฑ์กลางระบบ</th>
						<th class="p-4 text-center">เกณฑ์เฉพาะศูนย์ (Override)</th>
						<th class="p-4 pr-5 text-right">การจัดการ</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border/40">
					{#each filteredItems as item (item._id)}
						{@const override = overrides.find((o) => o.item_id === item._id)}
						{@const isCustom =
							override?.reorder_level !== null && override?.reorder_level !== undefined}
						<tr class="transition-colors hover:bg-muted/30">
							<td class="p-4 pl-5 font-semibold text-foreground">
								<div class="flex flex-col gap-0.5">
									<span class="text-sm">{item.name}</span>
									<span class="font-mono text-[10px] text-muted-foreground">{item._id}</span>
								</div>
							</td>
							<td class="p-4 text-center">
								<span class="rounded bg-muted px-2 py-0.5 text-[10px] font-bold">
									{SUPPLY_CATEGORY_LABELS[item.category as SupplyCategory] || item.category}
								</span>
							</td>
							<td class="p-4 text-center text-muted-foreground">{item.unit}</td>
							<td class="p-4 text-center font-mono">
								{item.reorder_level !== null ? item.reorder_level : '-'}
							</td>
							<td class="p-4 text-center">
								<div class="flex items-center justify-center gap-2">
									<Input
										type="number"
										min="0"
										placeholder={item.reorder_level !== null
											? String(item.reorder_level)
											: 'ยังไม่ตั้งเกณฑ์'}
										bind:value={editedLevels[item._id]}
										class="h-8 w-28 rounded-lg border border-border text-center font-mono text-xs"
									/>
								</div>
							</td>
							<td class="p-4 pr-5">
								<div class="flex items-center justify-end gap-2">
									{#if isCustom}
										<Button
											type="button"
											variant="outline"
											size="sm"
											onclick={() => handleClear(item._id)}
											class="h-8 rounded-xl border-destructive/20 bg-destructive/5 px-3 text-destructive hover:border-destructive/40 hover:bg-destructive/10"
											title="ยกเลิกเกณฑ์เตือนภัยเฉพาะศูนย์และกลับไปใช้ค่าของระบบ"
										>
											<RotateCcw class="mr-1 h-3.5 w-3.5" />
											คืนค่ากลาง
										</Button>
									{/if}
									<Button
										type="button"
										size="sm"
										onclick={() => handleSave(item._id)}
										disabled={saveMutation.isPending}
										class="h-8 rounded-xl px-3"
									>
										<Save class="mr-1 h-3.5 w-3.5" />
										บันทึก
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
