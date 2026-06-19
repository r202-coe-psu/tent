<script lang="ts">
	import type { Sop } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';

	let {
		sops = $bindable([])
	}: {
		sops: Sop[];
	} = $props();

	let sopFormId = $state('');
	let sopFormName = $state('');
	let sopFormDescription = $state('');
	let sopEditingIndex = $state<number | null>(null);

	function saveSop() {
		if (!sopFormId.trim() || !sopFormName.trim() || !sopFormDescription.trim()) {
			toast.error('กรุณากรอกข้อมูลรายการตรวจสอบ SOP ให้ครบถ้วน');
			return;
		}
		const newSop: Sop = {
			sop_id: sopFormId.trim(),
			name: sopFormName.trim(),
			description: sopFormDescription.trim()
		};
		if (sopEditingIndex !== null) {
			sops[sopEditingIndex] = newSop;
			sopEditingIndex = null;
			toast.success('แก้ไขรายการ SOP สำเร็จ');
		} else {
			if (sops.some((s) => s.sop_id === newSop.sop_id)) {
				toast.error('รหัสงาน SOP นี้มีอยู่แล้ว');
				return;
			}
			sops.push(newSop);
			toast.success('เพิ่มรายการ SOP สำเร็จ');
		}
		clearSopForm();
	}

	function editSop(index: number) {
		const s = sops[index];
		sopFormId = s.sop_id;
		sopFormName = s.name;
		sopFormDescription = s.description;
		sopEditingIndex = index;
	}

	function deleteSop(index: number) {
		sops.splice(index, 1);
		toast.success('ลบลำดับขั้นตอน SOP สำเร็จ');
	}

	function clearSopForm() {
		sopFormId = '';
		sopFormName = '';
		sopFormDescription = '';
		sopEditingIndex = null;
	}
</script>

<section class="mb-6 space-y-6 rounded-2xl border border-shelter-border bg-card p-6 shadow-sm">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-rose-bg text-xs font-bold text-shelter-rose-text"
			>5</span
		>
		<h2 class="text-base font-bold text-card-foreground">
			รายการตรวจสอบแผนดำเนินงานมาตรฐาน (Daily SOP Checklists)
		</h2>
	</div>

	<!-- Table View -->
	<div class="overflow-x-auto rounded-xl border border-shelter-border">
		<table class="w-full border-collapse text-left">
			<thead>
				<tr
					class="border-b border-shelter-border bg-muted/50 text-xs font-bold text-muted-foreground"
				>
					<th class="px-4 py-3">รหัสงาน SOP</th>
					<th class="px-4 py-3">หัวข้อภารกิจตรวจเช็ค</th>
					<th class="px-4 py-3">รายละเอียดขั้นตอนการดำเนินงาน (Standard Operating Procedure)</th>
					<th class="w-28 px-4 py-3 text-center">จัดการ</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-shelter-border text-xs text-foreground">
				{#if sops.length === 0}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground"
							>ยังไม่มีข้อมูลแผนตรวจสอบมาตรฐาน SOP</td
						>
					</tr>
				{:else}
					{#each sops as sop, index (sop.sop_id)}
						<tr class="hover:bg-muted/20">
							<td class="px-4 py-3 font-mono text-shelter-rose-text">{sop.sop_id}</td>
							<td class="px-4 py-3 font-bold text-foreground">{sop.name}</td>
							<td class="px-4 py-3 text-muted-foreground">{sop.description}</td>
							<td class="space-x-2 px-4 py-3 text-center">
								<button
									type="button"
									onclick={() => editSop(index)}
									class="text-muted-foreground hover:text-foreground"
									title="แก้ไข"
								>
									<Pencil class="inline h-4 w-4" />
								</button>
								<button
									type="button"
									onclick={() => deleteSop(index)}
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
			<span>ฟอร์มเพิ่ม/แก้ไข รายการแผนดำเนินงานมาตรฐาน (SOP)</span>
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="sop-id-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รหัสงาน SOP *</label
				>
				<Input
					id="sop-id-input"
					type="text"
					bind:value={sopFormId}
					placeholder="เช่น sop-morning-med"
				/>
			</div>
			<div>
				<label for="sop-name-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>หัวข้อภารกิจตรวจเช็ค *</label
				>
				<Input
					id="sop-name-input"
					type="text"
					bind:value={sopFormName}
					placeholder="เช่น ตรวจรอบเช้ากลุ่มเปราะบาง"
				/>
			</div>
			<div>
				<label for="sop-desc-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รายละเอียดขั้นตอนการดำเนินงาน (SOP) *</label
				>
				<Input
					id="sop-desc-input"
					type="text"
					bind:value={sopFormDescription}
					placeholder="เช่น ทีมแพทย์/อาสาสมัครเข้าตรวจวัดไข้..."
				/>
			</div>
		</div>
		<div class="flex justify-end space-x-2">
			<Button type="button" variant="outline" onclick={clearSopForm}>
				<RotateCcw class="h-3.5 w-3.5" />
				ล้างค่า
			</Button>
			<Button type="button" onclick={saveSop}>
				<Plus class="h-3.5 w-3.5" />
				บันทึกรายการ SOP
			</Button>
		</div>
	</div>
</section>
