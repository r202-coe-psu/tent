<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { m6ConfirmState, type M6Carrier } from '../domain/m6';

	/**
	 * Whether the central warehouse has been told this donation arrived. Renders nothing for a
	 * donation that is not m6 or not received yet. A failure is a warning, not a dead end: the
	 * sync worker keeps retrying on its own, so staff have nothing to redo.
	 */
	let { row }: { row: M6Carrier } = $props();

	const confirmState = $derived(m6ConfirmState(row));
</script>

{#if confirmState === 'confirmed'}
	<p
		role="status"
		class="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-900"
	>
		<CircleCheck class="size-4 shrink-0 text-emerald-700" aria-hidden="true" />
		ยืนยันกับ M6 แล้ว
	</p>
{:else if confirmState === 'failed'}
	<div
		role="status"
		class="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
	>
		<p class="flex items-center gap-1.5 font-semibold">
			<TriangleAlert class="size-4 shrink-0 text-amber-700" aria-hidden="true" />
			ยังยืนยันกับ M6 ไม่สำเร็จ
		</p>
		{#if row.m6?.confirm_error}
			<p class="break-words">สาเหตุ: {row.m6.confirm_error}</p>
		{/if}
		<p class="text-amber-800">ระบบจะลองยืนยันใหม่ให้เองโดยอัตโนมัติ ไม่ต้องรับของซ้ำ</p>
	</div>
{:else if confirmState === 'waiting'}
	<p
		role="status"
		class="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-900"
	>
		<LoaderCircle class="size-4 shrink-0 text-sky-700" aria-hidden="true" />
		กำลังยืนยันกับ M6
	</p>
{/if}
