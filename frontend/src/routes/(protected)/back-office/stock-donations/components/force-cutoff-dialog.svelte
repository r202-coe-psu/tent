<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	/**
	 * Force cut-off reason prompt (T-22, CR-052 §1.6).
	 *
	 * Closing a need by hand stops donors mid-flow while the target is still short, so
	 * the reason is collected before the call — it is what the audit entry is written
	 * from and what the transparency report shows.
	 *
	 * Lives here rather than inside the needs board itself: the board takes the cut-off
	 * action as a prop, so the page can intercept it and the shared board component
	 * stays untouched.
	 */
	let {
		open = false,
		itemName = '',
		onconfirm,
		oncancel
	}: {
		open?: boolean;
		itemName?: string;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	} = $props();

	let reason = $state('');

	function close() {
		reason = '';
		oncancel();
	}

	function confirm() {
		if (!reason.trim()) return;
		onconfirm(reason);
		reason = '';
	}
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && close()}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold">ปิดรับบริจาคด่วน (Force Cut-off)</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed">
				กำลังปิดรับ <span class="font-bold text-foreground">{itemName}</span>
				ทั้งที่ยอดยังไม่ครบเป้า — ต้องระบุเหตุผล เพราะเหตุผลนี้จะถูกบันทึกลง audit และแสดงในรายงานความโปร่งใส
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-1.5">
			<Label
				for="force-cutoff-reason"
				class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
			>
				เหตุผลการปิดรับ <span class="text-destructive">*</span>
			</Label>
			<Textarea
				id="force-cutoff-reason"
				bind:value={reason}
				rows={3}
				placeholder="เช่น พื้นที่คลังเต็ม / ของหมดอายุใกล้ / เปลี่ยนไปรับที่ศูนย์อื่น"
				class="text-xs"
			/>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="text-xs font-bold" onclick={close}>ยกเลิก</Button>
			<Button
				disabled={!reason.trim()}
				variant="destructive"
				class="bg-destructive text-xs font-bold text-white hover:bg-destructive/90"
				onclick={confirm}
			>
				ยืนยันปิดรับ
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
