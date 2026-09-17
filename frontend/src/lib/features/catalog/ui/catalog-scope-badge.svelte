<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import Globe from '@lucide/svelte/icons/globe';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CircleSlash from '@lucide/svelte/icons/circle-slash';

	let {
		doc
	}: {
		doc: {
			shelter_code?: string | null;
			override?: boolean;
			deactivated?: boolean;
			is_protected?: boolean;
		};
	} = $props();
</script>

{#if doc.deactivated}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
	>
		<CircleSlash class="size-3.5" />
		ปิดใช้งาน
	</span>
{/if}

{#if doc.is_protected}
	<span class="badge-accent">
		<Lock class="size-3.5" />
		หมวดหมู่ระบบ
	</span>
{:else if !doc.shelter_code}
	<span class="badge-muted">
		<Globe class="size-3.5" />
		ส่วนกลาง
	</span>
{:else if doc.override}
	<span class="badge-warning-advisory">
		<PencilLine class="size-3.5" />
		ปรับแต่งแล้ว
	</span>
{:else}
	<span class="badge-inventory">
		<Building2 class="size-3.5" />
		เฉพาะศูนย์
	</span>
{/if}
