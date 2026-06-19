<script lang="ts">
	import type { Item } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';

	let {
		items = $bindable([])
	}: {
		items: Item[];
	} = $props();

	let itemFormId = $state('');
	let itemFormName = $state('');
	let itemFormUnit = $state('');
	let itemEditingIndex = $state<number | null>(null);

	function saveItem() {
		if (!itemFormId.trim() || !itemFormName.trim() || !itemFormUnit.trim()) {
			toast.error('กรุณากรอกข้อมูลสิ่งของให้ครบถ้วน');
			return;
		}
		const newItem: Item = {
			item_id: itemFormId.trim(),
			name: itemFormName.trim(),
			unit: itemFormUnit.trim()
		};
		if (itemEditingIndex !== null) {
			items[itemEditingIndex] = newItem;
			itemEditingIndex = null;
			toast.success('แก้ไขข้อมูลคลังสิ่งของสำเร็จ');
		} else {
			if (items.some((i) => i.item_id === newItem.item_id)) {
				toast.error('รหัสสิ่งของนี้มีอยู่แล้ว');
				return;
			}
			items.push(newItem);
			toast.success('เพิ่มข้อมูลคลังสิ่งของสำเร็จ');
		}
		clearItemForm();
	}

	function editItem(index: number) {
		const i = items[index];
		itemFormId = i.item_id;
		itemFormName = i.name;
		itemFormUnit = i.unit;
		itemEditingIndex = index;
	}

	function deleteItem(index: number) {
		items.splice(index, 1);
		toast.success('ลบข้อมูลสิ่งของสำเร็จ');
	}

	function clearItemForm() {
		itemFormId = '';
		itemFormName = '';
		itemFormUnit = '';
		itemEditingIndex = null;
	}
</script>

<section class="mb-6 space-y-6 rounded-2xl border border-shelter-border bg-card p-6 shadow-sm">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-amber-bg text-xs font-bold text-shelter-amber-text"
			>3</span
		>
		<h2 class="text-base font-bold text-card-foreground">
			คลังสิ่งของบรรเทาทุกข์เริ่มต้น (Inventory Items Master)
		</h2>
	</div>

	<!-- Table View -->
	<div class="overflow-x-auto rounded-xl border border-shelter-border">
		<table class="w-full border-collapse text-left">
			<thead>
				<tr
					class="border-b border-shelter-border bg-muted/50 text-xs font-bold text-muted-foreground"
				>
					<th class="px-4 py-3">รหัสสิ่งของ (Item ID)</th>
					<th class="px-4 py-3">ชื่อสิ่งของบรรเทาทุกข์</th>
					<th class="px-4 py-3">หน่วยนับ</th>
					<th class="w-28 px-4 py-3 text-center">จัดการ</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-shelter-border text-xs text-foreground">
				{#if items.length === 0}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground"
							>ยังไม่มีข้อมูลสิ่งของในคลัง</td
						>
					</tr>
				{:else}
					{#each items as item, index (item.item_id)}
						<tr class="hover:bg-muted/20">
							<td class="px-4 py-3 font-mono text-muted-foreground">{item.item_id}</td>
							<td class="px-4 py-3 font-bold text-foreground">{item.name}</td>
							<td class="px-4 py-3 text-foreground">{item.unit}</td>
							<td class="space-x-2 px-4 py-3 text-center">
								<button
									type="button"
									onclick={() => editItem(index)}
									class="text-muted-foreground hover:text-foreground"
									title="แก้ไข"
								>
									<Pencil class="inline h-4 w-4" />
								</button>
								<button
									type="button"
									onclick={() => deleteItem(index)}
									class="text-destructive hover:text-destructive/80"
									title="ลบ"
								>
									<Trash2 class="inline h-4 w-4" />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Form View -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-shelter-bg p-5">
		<h3
			class="flex items-center space-x-1 text-xs font-bold tracking-wider text-muted-foreground uppercase"
		>
			<Plus class="h-3.5 w-3.5 text-muted-foreground" />
			<span>ฟอร์มเพิ่ม/แก้ไข ข้อมูลสิ่งของในคลัง</span>
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="item-id-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รหัสสิ่งของ (Item ID) *</label
				>
				<Input
					id="item-id-input"
					type="text"
					bind:value={itemFormId}
					placeholder="เช่น item-water-pack"
				/>
			</div>
			<div>
				<label for="item-name-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>ชื่อสิ่งของบรรเทาทุกข์ *</label
				>
				<Input
					id="item-name-input"
					type="text"
					bind:value={itemFormName}
					placeholder="เช่น น้ำดื่มบรรจุขวด (แพ็ค 12 ขวด)"
				/>
			</div>
			<div>
				<label for="item-unit-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>หน่วยนับ *</label
				>
				<Input
					id="item-unit-input"
					type="text"
					bind:value={itemFormUnit}
					placeholder="เช่น แพ็ค, ชุด, ผืน, กล่อง"
				/>
			</div>
		</div>
		<div class="flex justify-end space-x-2">
			<Button type="button" variant="outline" onclick={clearItemForm}>
				<RotateCcw class="h-3.5 w-3.5" />
				ล้างค่า
			</Button>
			<Button type="button" onclick={saveItem}>
				<Plus class="h-3.5 w-3.5" />
				บันทึกข้อมูลสิ่งของ
			</Button>
		</div>
	</div>
</section>
