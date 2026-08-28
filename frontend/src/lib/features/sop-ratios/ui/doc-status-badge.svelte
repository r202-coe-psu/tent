<script lang="ts">
	import type { DocAlertStatus } from '../domain/replenishment-calc';

	let {
		status = 'UNCONFIGURED',
		docDays = null,
		itemId = '',
		compact = false
	}: {
		status: DocAlertStatus;
		docDays?: number | null;
		itemId?: string;
		compact?: boolean;
	} = $props();

	const testId = $derived(
		itemId ? `doc-badge-${itemId.replace(/^item_master:/, '')}` : 'doc-status-badge'
	);

	const STATUS_MAP: Record<
		DocAlertStatus,
		{ badgeClass: string; dotClass: string; label: string; compactLabel: string }
	> = {
		CRITICAL: {
			badgeClass: 'badge-status-critical',
			dotClass: 'badge-dot-critical',
			label: 'สต็อกวิกฤต',
			compactLabel: 'สต็อกวิกฤต'
		},
		WARNING_REORDER: {
			badgeClass: 'badge-status-warning',
			dotClass: 'badge-dot-warning',
			label: 'ถึงจุดสั่งเติม',
			compactLabel: 'ถึงจุดสั่งเติม'
		},
		ADEQUATE: {
			badgeClass: 'badge-status-adequate',
			dotClass: 'badge-dot-adequate',
			label: 'สต็อกปลอดภัย',
			compactLabel: 'สต็อกปลอดภัย'
		},
		OVERSTOCK: {
			badgeClass: 'badge-status-overstock',
			dotClass: 'badge-dot-overstock',
			label: 'สต็อกเกินเกณฑ์',
			compactLabel: 'สต็อกเกินเกณฑ์'
		},
		UNCONFIGURED: {
			badgeClass: 'badge-status-unconfigured',
			dotClass: 'badge-dot-unconfigured',
			label: 'ยังไม่ได้ตั้งค่า',
			compactLabel: 'ยังไม่ได้ตั้งค่า'
		}
	};

	const current = $derived(STATUS_MAP[status] ?? STATUS_MAP.UNCONFIGURED);
</script>

<span
	data-testid={testId}
	class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap {current.badgeClass}"
>
	<span class="h-2 w-2 shrink-0 rounded-full {current.dotClass}"></span>

	<span class="shrink-0">{compact ? current.compactLabel : current.label}</span>

	{#if docDays !== null && docDays !== undefined}
		<span class="shrink-0 font-mono opacity-80">({docDays.toFixed(1)} วัน)</span>
	{/if}
</span>
