<script module lang="ts">
	import type { Component } from 'svelte';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Globe from '@lucide/svelte/icons/globe';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Laptop from '@lucide/svelte/icons/laptop';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileText from '@lucide/svelte/icons/file-text';

	export interface RegisteredViaStyle {
		label: string;
		badgeClass: string;
		iconClass: string;
		icon: Component;
	}

	export const REGISTERED_VIA_BADGE_STYLES: Record<string, RegisteredViaStyle> = {
		kiosk: {
			label: 'ตู้ Kiosk',
			badgeClass: 'border-amber-200 bg-amber-50 text-amber-900',
			iconClass: 'text-amber-700',
			icon: CreditCard
		},
		web: {
			label: 'ออนไลน์ Web',
			badgeClass: 'border-sky-200 bg-sky-50 text-sky-900',
			iconClass: 'text-sky-700',
			icon: Globe
		},
		staff: {
			label: 'โต๊ะเจ้าหน้าที่',
			badgeClass: 'border-slate-200 bg-slate-50 text-slate-700',
			iconClass: 'text-slate-600',
			icon: UserPlus
		},
		backoffice: {
			label: 'Backoffice',
			badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-900',
			iconClass: 'text-indigo-700',
			icon: Laptop
		},
		import: {
			label: 'นำเข้าไฟล์',
			badgeClass: 'border-teal-200 bg-teal-50 text-teal-900',
			iconClass: 'text-teal-700',
			icon: FileSpreadsheet
		},
		paper: {
			label: 'เอกสารกระดาษ',
			badgeClass: 'border-slate-200 bg-slate-50 text-slate-700',
			iconClass: 'text-slate-600',
			icon: FileText
		},
		app: {
			label: 'แอปพลิเคชัน',
			badgeClass: 'border-blue-200 bg-blue-50 text-blue-900',
			iconClass: 'text-blue-700',
			icon: Laptop
		}
	};
</script>

<script lang="ts">
	let {
		via,
		hasCardSnapshot = false,
		size = 'sm',
		showIcon = true,
		customLabel,
		class: className = ''
	}: {
		via?: string | null;
		hasCardSnapshot?: boolean;
		size?: 'sm' | 'md';
		showIcon?: boolean;
		customLabel?: string;
		class?: string;
	} = $props();

	const effectiveVia = $derived(via || (hasCardSnapshot ? 'kiosk' : 'staff'));

	const style = $derived(
		REGISTERED_VIA_BADGE_STYLES[effectiveVia] ?? {
			label: effectiveVia || 'ไม่ระบุ',
			badgeClass: 'border-slate-200 bg-slate-50 text-slate-700',
			iconClass: 'text-slate-600',
			icon: UserPlus
		}
	);

	const displayLabel = $derived(customLabel ?? style.label);
	const Icon = $derived(style.icon);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border font-semibold transition-colors {style.badgeClass} {size ===
	'sm'
		? 'px-2.5 py-0.5 text-xs'
		: 'px-3 py-1 text-sm'} {className}"
>
	{#if showIcon}
		<Icon class="{size === 'sm' ? 'size-3.5' : 'size-4'} {style.iconClass} shrink-0" />
	{/if}
	<span>{displayLabel}</span>
</span>
