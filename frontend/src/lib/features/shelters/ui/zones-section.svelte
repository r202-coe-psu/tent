<script lang="ts">
	import type { Zone } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';

	let {
		zones = $bindable([])
	}: {
		zones: Zone[];
	} = $props();

	let zoneFormId = $state('');
	let zoneFormName = $state('');
	let zoneFormCapacity = $state<number>(0);
	let zoneEditingIndex = $state<number | null>(null);

	function saveZone() {
		if (!zoneFormId.trim() || !zoneFormName.trim()) {
			toast.error('กรุณากรอกรหัสโซนและชื่อโซน');
			return;
		}
		if (zoneFormCapacity <= 0) {
			toast.error('ความจุของโซนต้องมากกว่า 0');
			return;
		}
		const newZone: Zone = {
			code: zoneFormId.trim(),
			name: zoneFormName.trim(),
			capacity: Number(zoneFormCapacity)
		};
		if (zoneEditingIndex !== null) {
			zones[zoneEditingIndex] = newZone;
			zoneEditingIndex = null;
			toast.success('แก้ไขข้อมูลโซนสำเร็จ');
		} else {
			if (zones.some((z) => z.code === newZone.code)) {
				toast.error('รหัสโซนนี้มีอยู่แล้ว');
				return;
			}
			zones.push(newZone);
			toast.success('เพิ่มโซนสำเร็จ');
		}
		clearZoneForm();
	}

	function editZone(index: number) {
		const z = zones[index];
		zoneFormId = z.code;
		zoneFormName = z.name;
		zoneFormCapacity = z.capacity;
		zoneEditingIndex = index;
	}

	function deleteZone(index: number) {
		zones.splice(index, 1);
		toast.success('ลบโซนสำเร็จ');
	}

	function clearZoneForm() {
		zoneFormId = '';
		zoneFormName = '';
		zoneFormCapacity = 0;
		zoneEditingIndex = null;
	}
</script>

<section class="mb-6 space-y-6 rounded-2xl border border-shelter-border bg-card p-6 shadow-sm">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-purple-bg text-xs font-bold text-shelter-purple-text"
			>2</span
		>
		<h2 class="text-base font-bold text-card-foreground">จัดการข้อมูลโซนภายในศูนย์ (Zones)</h2>
	</div>

	<!-- Table View -->
	<div class="overflow-x-auto rounded-xl border border-shelter-border">
		<table class="w-full border-collapse text-left">
			<thead>
				<tr
					class="border-b border-shelter-border bg-muted/50 text-xs font-bold text-muted-foreground"
				>
					<th class="px-4 py-3">รหัสโซน (Zone ID)</th>
					<th class="px-4 py-3">ชื่อโซนภายในศูนย์</th>
					<th class="px-4 py-3">ความจุของโซน (คน)</th>
					<th class="w-28 px-4 py-3 text-center">จัดการ</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-shelter-border text-xs text-foreground">
				{#if zones.length === 0}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground"
							>ยังไม่มีข้อมูลโซน</td
						>
					</tr>
				{:else}
					{#each zones as zone, index (zone.code)}
						<tr class="hover:bg-muted/20">
							<td class="px-4 py-3 font-mono text-shelter-purple-text">{zone.code}</td>
							<td class="px-4 py-3 font-bold text-foreground">{zone.name}</td>
							<td class="px-4 py-3 font-semibold text-foreground">{zone.capacity}</td>
							<td class="space-x-2 px-4 py-3 text-center">
								<button
									type="button"
									onclick={() => editZone(index)}
									class="text-muted-foreground hover:text-foreground"
									title="แก้ไข"
								>
									<Pencil class="inline h-4 w-4" />
								</button>
								<button
									type="button"
									onclick={() => deleteZone(index)}
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
			<Plus class="h-3.5 w-3.5 text-muted-foreground" /> <span>ฟอร์มเพิ่ม/แก้ไข ข้อมูลโซน</span>
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="zone-id-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รหัสโซน (Zone ID) *</label
				>
				<Input
					id="zone-id-input"
					type="text"
					bind:value={zoneFormId}
					placeholder="เช่น zone-general-hy"
				/>
			</div>
			<div>
				<label for="zone-name-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>ชื่อโซนภายในศูนย์ *</label
				>
				<Input
					id="zone-name-input"
					type="text"
					bind:value={zoneFormName}
					placeholder="เช่น ZONE GENERAL"
				/>
			</div>
			<div>
				<label for="zone-capacity-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>ความจุของโซน (คน) *</label
				>
				<Input
					id="zone-capacity-input"
					type="number"
					bind:value={zoneFormCapacity}
					placeholder="เช่น 100"
				/>
			</div>
		</div>
		<div class="flex justify-end space-x-2">
			<Button type="button" variant="outline" onclick={clearZoneForm}>
				<RotateCcw class="h-3.5 w-3.5" />
				ล้างค่า
			</Button>
			<Button type="button" onclick={saveZone}>
				<Plus class="h-3.5 w-3.5" />
				บันทึกข้อมูลโซน
			</Button>
		</div>
	</div>
</section>
