<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Confirm "ปิดใบ" (CR-206 FR-MP-26, FR-MP-27): the lines no point has recorded are closed
	 * as not delivered — they land in `shortfalls` and their reservation is released. Cannot
	 * be undone, so it asks first.
	 */
	let {
		open = $bindable(false),
		bookingRef,
		openLines,
		pending = false,
		onconfirm
	}: {
		open?: boolean;
		bookingRef: string;
		/** Names of the lines still without a result. */
		openLines: readonly string[];
		pending?: boolean;
		onconfirm: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-testid="close-donation-dialog">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-slate-900">ปิดใบ {bookingRef}</Dialog.Title>
			<Dialog.Description class="text-base leading-relaxed text-slate-700">
				รายการที่ยังไม่มีจุดไหนรับจะนับว่าผู้บริจาคไม่ได้นำมาส่ง และคืนยอดจองให้ศูนย์
				ปิดแล้วรับของเพิ่มในใบนี้ไม่ได้
			</Dialog.Description>
		</Dialog.Header>

		{#if openLines.length > 0}
			<div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
				<p class="text-sm font-semibold text-amber-900">
					ยังไม่ได้รับ <span class="tabular-nums">{openLines.length}</span> รายการ
				</p>
				<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
					{#each openLines as line, i (`${line}:${i}`)}
						<li>{line}</li>
					{/each}
				</ul>
			</div>
		{/if}

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
				data-testid="close-donation-confirm"
				onclick={onconfirm}
			>
				{pending ? 'กำลังปิดใบ…' : 'ยืนยันปิดใบ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
