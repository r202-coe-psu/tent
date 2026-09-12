<script module lang="ts">
	import type { StayStatus } from '../domain/people';

	export interface StatusStyle {
		label: string;
		badgeClass: string;
		dotClass: string;
	}

	export const STAY_STATUS_BADGE_STYLES: Record<StayStatus, StatusStyle> = {
		pre_registered: {
			label: 'ลงทะเบียนล่วงหน้า',
			badgeClass:
				'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
			dotClass: 'bg-blue-500'
		},
		arriving: {
			label: 'รอเข้าพัก',
			badgeClass:
				'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
			dotClass: 'bg-amber-500'
		},
		active: {
			label: 'เข้าพักแล้ว',
			badgeClass:
				'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-300',
			dotClass: 'bg-green-500'
		},
		room_confirmed: {
			label: 'ยืนยันถึงโซนแล้ว',
			badgeClass:
				'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
			dotClass: 'bg-emerald-600'
		},
		temporary_leave: {
			label: 'ออกชั่วคราว',
			badgeClass:
				'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300',
			dotClass: 'bg-orange-500'
		},
		transferred: {
			label: 'ย้ายศูนย์',
			badgeClass:
				'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
			dotClass: 'bg-purple-500'
		},
		checked_out: {
			label: 'เช็คเอาต์',
			badgeClass:
				'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
			dotClass: 'bg-slate-400'
		},
		deceased: {
			label: 'เสียชีวิต',
			badgeClass:
				'border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100',
			dotClass: 'bg-slate-900 dark:bg-slate-100'
		},
		cancelled: {
			label: 'ยกเลิก',
			badgeClass:
				'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
			dotClass: 'bg-slate-300'
		}
	};
</script>

<script lang="ts">
	let {
		status,
		size = 'sm',
		showDot = true,
		customLabel,
		class: className = ''
	}: {
		status: StayStatus | string;
		size?: 'sm' | 'md';
		showDot?: boolean;
		customLabel?: string;
		class?: string;
	} = $props();

	const style = $derived(
		STAY_STATUS_BADGE_STYLES[status as StayStatus] ?? {
			label: status || 'ไม่ระบุ',
			badgeClass: 'border-slate-200 bg-slate-50 text-slate-600',
			dotClass: 'bg-slate-400'
		}
	);

	const displayLabel = $derived(customLabel ?? style.label);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors {style.badgeClass} {size ===
	'sm'
		? 'px-2.5 py-0.5 text-xs'
		: 'px-3 py-1 text-sm'} {className}"
>
	{#if showDot}
		<span class="size-1.5 shrink-0 rounded-full {style.dotClass}" aria-hidden="true"></span>
	{/if}
	<span>{displayLabel}</span>
</span>
