<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Household } from '$lib/features/people';

	let {
		show,
		household,
		onClose,
		onSave
	}: {
		show: boolean;
		household: Household;
		onClose: () => void;
		onSave: (data: {
			addressNo: string;
			villageNo: string;
			subdistrict: string;
			district: string;
			province: string;
			postalCode: string;
		}) => Promise<void>;
	} = $props();

	let addressNo = $state(untrack(() => household.address_no ?? ''));
	let villageNo = $state(untrack(() => household.village_no ?? ''));
	let subdistrict = $state(untrack(() => household.subdistrict ?? ''));
	let district = $state(untrack(() => household.district ?? ''));
	let province = $state(untrack(() => household.province ?? ''));
	let postalCode = $state(untrack(() => household.postal_code ?? ''));
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-lg animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					แก้ไขที่อยู่ครอบครัว (Family Address)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<Label for="address_no">บ้านเลขที่</Label>
					<Input id="address_no" bind:value={addressNo} placeholder="เช่น 123/45" />
				</div>
				<div class="space-y-1.5">
					<Label for="village_no">หมู่ที่</Label>
					<Input id="village_no" bind:value={villageNo} placeholder="เช่น หมู่ 2" />
				</div>
				<div class="space-y-1.5">
					<Label for="subdistrict">ตำบล / แขวง</Label>
					<Input id="subdistrict" bind:value={subdistrict} placeholder="เช่น คลองเรียน" />
				</div>
				<div class="space-y-1.5">
					<Label for="district">อำเภอ / เขต</Label>
					<Input id="district" bind:value={district} placeholder="เช่น หาดใหญ่" />
				</div>
				<div class="space-y-1.5">
					<Label for="province">จังหวัด</Label>
					<Input id="province" bind:value={province} placeholder="เช่น สงขลา" />
				</div>
				<div class="space-y-1.5">
					<Label for="postal_code">รหัสไปรษณีย์</Label>
					<Input id="postal_code" bind:value={postalCode} placeholder="เช่น 90110" />
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button
					onclick={() =>
						onSave({ addressNo, villageNo, subdistrict, district, province, postalCode })}
				>
					บันทึกข้อมูล
				</Button>
			</div>
		</div>
	</div>
{/if}
