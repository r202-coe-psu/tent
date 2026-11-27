<script lang="ts">
	/**
	 * Previous / next for a list the DB pages with a Mango `bookmark`. A bookmark only continues
	 * forward, so there is no jump-to-page: the owner keeps the bookmark of every page it has seen.
	 */
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		page,
		hasNext,
		pending = false,
		onprev,
		onnext
	}: {
		/** 1-based number of the page on screen. */
		page: number;
		hasNext: boolean;
		pending?: boolean;
		onprev: () => void;
		onnext: () => void;
	} = $props();
</script>

{#if page > 1 || hasNext}
	<nav class="flex items-center justify-center gap-3 pt-3" aria-label="เปลี่ยนหน้ารายชื่อ">
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="gap-1"
			disabled={page <= 1 || pending}
			onclick={onprev}
		>
			<ChevronLeft class="h-4 w-4" />
			ก่อนหน้า
		</Button>
		<span class="text-xs text-muted-foreground tabular-nums">หน้า {page}</span>
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="gap-1"
			disabled={!hasNext || pending}
			onclick={onnext}
		>
			ถัดไป
			<ChevronRight class="h-4 w-4" />
		</Button>
	</nav>
{/if}
