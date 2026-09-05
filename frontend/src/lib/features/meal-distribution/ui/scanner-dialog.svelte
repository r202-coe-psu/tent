<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { getMealsStore } from '../application/meal-distribution-store.svelte';

	const store = getMealsStore();
</script>

<Dialog.Root
	open={store.isScannerOpen}
	onOpenChange={(open) => {
		store.isScannerOpen = open;
	}}
>
	<Dialog.Content class="flex max-h-[85vh] w-full flex-col gap-4 rounded-2xl p-6 sm:max-w-md">
		<Dialog.Header class="border-b pb-2">
			<Dialog.Title class="flex items-center gap-2 text-base font-extrabold">
				<QrCode class="size-5 text-amber-500" />
				<span>จำลองเครื่องสแกนบาร์โค้ด QR สายรัดข้อมือ</span>
			</Dialog.Title>
		</Dialog.Header>

		<div
			class="border-slate-150 space-y-2 rounded-xl border bg-slate-50 p-4 text-center dark:bg-zinc-800/30"
		>
			<div
				class="mx-auto flex size-24 items-center justify-center rounded-xl border-2 border-dashed border-amber-500 text-amber-500"
			>
				<QrCode class="size-12 animate-pulse" />
			</div>
			<p class="text-xs font-bold text-slate-700 dark:text-slate-300">
				คลิกเลือกรายชื่อด้านล่างเพื่อทำการสแกนเสมือนจริง
			</p>
		</div>

		<div class="max-h-[200px] space-y-2 overflow-y-auto pr-1">
			{#each store.recipients as recipient (recipient.id)}
				{@const served = store.activeKioskMenu
					? store.hasReceived(recipient.id, store.activeKioskMenu.id)
					: false}
				<button
					onclick={() => store.handleSimulatedScan(recipient)}
					disabled={served}
					class="flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-xs transition-all
						{served
						? 'border-slate-100 bg-slate-50 opacity-60'
						: 'bg-white hover:border-amber-500 hover:bg-amber-50/20 dark:bg-zinc-900'}"
				>
					<div>
						<div class="font-bold text-slate-800 dark:text-white">{recipient.name}</div>
						<div class="text-[10px] text-slate-400">
							Wristband ID: {recipient.wristbandCode} | เตียง {recipient.bed}
						</div>
					</div>

					{#if served}
						<span
							class="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
						>
							รับแล้ว
						</span>
					{:else}
						<span
							class="rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800"
						>
							สแกน
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
