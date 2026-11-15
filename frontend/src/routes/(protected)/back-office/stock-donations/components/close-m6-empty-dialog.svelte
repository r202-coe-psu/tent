<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Confirm "ปิดใบ — ไม่ได้รับของ" on a central-warehouse (M6) donation nothing has been recorded
	 * on: the goods never arrived. The donation closes as received with every line a shortfall and
	 * the system tells M6 so. Cannot be undone, so it asks first.
	 */
	let {
		open = $bindable(false),
		bookingRef,
		pending = false,
		onconfirm
	}: {
		open?: boolean;
		bookingRef: string;
		pending?: boolean;
		onconfirm: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-testid="close-m6-empty-dialog">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-slate-900">
				ปิดใบ {bookingRef} — ไม่ได้รับของ
			</Dialog.Title>
			<Dialog.Description class="text-base leading-relaxed text-slate-700">
				ยืนยันว่าไม่ได้รับของจากคลังกลาง M6 ระบบจะแจ้ง M6 ว่าไม่ได้รับของ
				ปิดแล้วรับของเพิ่มในใบนี้ไม่ได้
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer class="gap-2">
			<Button
				variant="outline"
				class="min-h-11 text-sm font-semibold"
				disabled={pending}
				onclick={() => (open = false)}
			>
				ยกเลิก
			</Button>
			<Button
				class="min-h-11 bg-red-600 text-sm font-bold text-white hover:bg-red-700"
				disabled={pending}
				data-testid="close-m6-empty-confirm"
				onclick={onconfirm}
			>
				{pending ? 'กำลังปิดใบ…' : 'ยืนยันไม่ได้รับของ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
