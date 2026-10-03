<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import type { ItemMaster } from '../domain/catalog';
	import QuickCreateItem from './quick-create-item.svelte';

	let {
		open = $bindable(false),
		shelterCode,
		initialName = '',
		initialBarcode = '',
		submitLabel,
		backLabel = 'กลับไปหน้าเดิม (ข้อมูลที่กรอกไว้ยังอยู่)',
		onCreated,
		onUseExisting,
		onOpenChangeComplete,
		onCloseAutoFocus
	}: {
		open?: boolean;
		shelterCode: string;
		initialName?: string;
		initialBarcode?: string;
		submitLabel?: string;
		backLabel?: string;
		onCreated: (item: ItemMaster) => void;
		onUseExisting: (item: ItemMaster) => void;
		/** Fires after the close animation, e.g. to move focus to the next field. */
		onOpenChangeComplete?: (open: boolean) => void;
		/** Lets the caller keep focus where it chose instead of returning to the trigger. */
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	const isMobileViewport = new IsMobile();

	const close = () => (open = false);
	const created = (item: ItemMaster) => {
		open = false;
		onCreated(item);
	};
	const useExisting = (item: ItemMaster) => {
		open = false;
		onUseExisting(item);
	};
</script>

{#snippet header()}
	<Button
		type="button"
		variant="ghost"
		class="-ml-2 min-h-11 w-fit justify-start px-2 text-sm font-semibold text-sky-800"
		onclick={close}
	>
		← {backLabel}
	</Button>
{/snippet}

{#snippet form()}
	<QuickCreateItem
		{shelterCode}
		{initialName}
		{initialBarcode}
		{submitLabel}
		onCreated={created}
		onUseExisting={useExisting}
		onCancel={close}
	/>
{/snippet}

{#if isMobileViewport.current}
	<Sheet.Root bind:open {onOpenChangeComplete}>
		<Sheet.Content
			side="bottom"
			{onCloseAutoFocus}
			class="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pb-[env(safe-area-inset-bottom)]"
		>
			<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-3 pr-12 text-left">
				{@render header()}
				<Sheet.Title class="text-xl font-bold text-slate-900">สร้างสินค้าใหม่</Sheet.Title>
				<Sheet.Description class="text-sm text-slate-500">
					กรอกแค่ที่จำเป็นต่อการรับของ ข้อมูลอื่นเติมทีหลังได้
				</Sheet.Description>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				{@render form()}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Dialog.Root bind:open {onOpenChangeComplete}>
		<Dialog.Content
			{onCloseAutoFocus}
			class="max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-md sm:max-w-xl sm:p-6"
		>
			<Dialog.Header class="space-y-1 border-b border-slate-200/80 pb-4 text-left">
				{@render header()}
				<Dialog.Title class="text-xl font-bold text-slate-900">สร้างสินค้าใหม่</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-500">
					กรอกแค่ที่จำเป็นต่อการรับของ ข้อมูลอื่นเติมทีหลังได้
				</Dialog.Description>
			</Dialog.Header>
			{@render form()}
		</Dialog.Content>
	</Dialog.Root>
{/if}
