<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { remainingPortions } from '../domain/meal-distribution';
	import { getMealsStore } from '../application/meal-distribution-store.svelte';

	const store = getMealsStore();
	const menu = $derived(store.closeBatchTarget);

	let note = $state('');

	function handleCancel() {
		note = '';
		store.cancelCloseBatch();
	}

	function handleConfirm() {
		store.confirmCloseBatch(note);
		note = '';
	}
</script>

<Dialog.Root
	open={menu !== null}
	onOpenChange={(open) => {
		if (!open) handleCancel();
	}}
>
	<Dialog.Content class="rounded-2xl sm:max-w-md">
		{#if menu}
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-base font-extrabold">
					<span
						class="flex size-8 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/30"
					>
						<RotateCcw class="size-4" />
					</span>
					<span>ยืนยันปิดรอบแจกจ่าย (เมนูนี้)</span>
				</Dialog.Title>
			</Dialog.Header>

			<div class="space-y-3 text-sm">
				<p class="text-slate-700 dark:text-slate-300">
					คุณกำลังปิดรอบเมนู <strong class="font-bold text-slate-900 dark:text-white"
						>{menu.title}</strong
					>
				</p>
				<p class="text-slate-700 dark:text-slate-300">
					ยอดเบิกทำจริง <strong class="font-bold text-slate-900 dark:text-white"
						>{menu.target} ที่</strong
					>
					| แจกจ่ายแล้ว
					<strong class="font-bold text-emerald-700 dark:text-emerald-400">{menu.served} ที่</strong
					>
					(ส่วนต่างอาหารเหลือ/เสีย
					<strong class="font-bold text-amber-700 dark:text-amber-400"
						>{remainingPortions(menu)} ที่</strong
					>)
				</p>
			</div>

			<div class="space-y-1.5">
				<Label for="close-batch-note" class="text-xs font-bold text-slate-600 dark:text-zinc-400">
					หมายเหตุการจัดการส่วนต่าง (อาหารเหลือ/บูดทิ้ง)
				</Label>
				<Textarea
					id="close-batch-note"
					bind:value={note}
					placeholder="เช่น ทิ้งเนื่องจากหมดเวลารับ หรือ นำแจกจ่ายเจ้าหน้าที่ผู้ปฏิบัติงาน..."
					class="min-h-20 text-sm"
				/>
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={handleCancel}>ยกเลิก</Button>
				<Button onclick={handleConfirm} class="bg-rose-600 font-bold text-white hover:bg-rose-700">
					ปิดแจกเมนูนี้
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
