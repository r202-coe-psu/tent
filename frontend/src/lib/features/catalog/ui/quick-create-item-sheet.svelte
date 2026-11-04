<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import type { ItemMaster } from '../domain/catalog';
	import QuickCreateItem from './quick-create-item.svelte';

	let {
		open = $bindable(false),
		shelterCode,
		initialName = '',
		onCreated,
		onUseExisting
	}: {
		open?: boolean;
		shelterCode: string;
		/** Pre-filled item name (what the user had typed in a search box). */
		initialName?: string;
		onCreated: (item: ItemMaster) => void;
		/** The user picked a similar existing item instead of creating a duplicate. */
		onUseExisting: (item: ItemMaster) => void;
	} = $props();

	const isMobileViewport = new IsMobile();

	function created(item: ItemMaster) {
		open = false;
		onCreated(item);
	}

	function useExisting(item: ItemMaster) {
		open = false;
		onUseExisting(item);
	}
</script>

<!-- A side sheet (bottom on mobile), same shape as the scan station's create panel.
	The form is mounted only while open so each opening starts from a clean draft. -->
<Sheet.Root bind:open>
	<Sheet.Content
		side={isMobileViewport.current ? 'bottom' : 'right'}
		class={[
			'flex flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)]',
			isMobileViewport.current
				? 'h-[100dvh] max-h-[100dvh] rounded-none'
				: 'h-[100dvh] w-full sm:max-w-none md:w-[37.5rem] md:border-l'
		]}
	>
		<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-4 pr-14 text-left sm:px-6">
			<Sheet.Title class="text-xl font-bold text-slate-900">สร้างสินค้าใหม่</Sheet.Title>
			<Sheet.Description class="text-sm text-slate-500">
				กรอกแค่ที่จำเป็นต่อการรับของ ข้อมูลอื่นเติมทีหลังได้
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
			{#if open}
				<QuickCreateItem
					{shelterCode}
					{initialName}
					onCreated={created}
					onUseExisting={useExisting}
					onCancel={() => (open = false)}
				/>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
