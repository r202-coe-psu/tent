<script lang="ts">
	import type { ReadinessVerdict, AssessmentLifecycleStatus } from '../domain/readiness.types';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import HelpCircle from '@lucide/svelte/icons/help-circle';

	interface Props {
		verdict?: ReadinessVerdict | null;
		status?: AssessmentLifecycleStatus;
		size?: 'sm' | 'md' | 'lg';
	}

	let { verdict = null, status = 'submitted', size = 'md' }: Props = $props();

	const config = $derived.by(() => {
		if (status === 'draft') {
			return {
				label: 'แบบร่าง (Draft)',
				icon: Clock,
				classes: 'bg-slate-100 text-slate-700 border-slate-300'
			};
		}

		switch (verdict) {
			case 'ready':
				return {
					label: 'พร้อมเปิดใช้งาน (Ready)',
					icon: CheckCircle2,
					classes: 'bg-emerald-50 text-emerald-800 border-emerald-300'
				};
			case 'conditional_pass':
				return {
					label: 'พร้อมแบบมีเงื่อนไข (Conditional)',
					icon: AlertTriangle,
					classes: 'bg-amber-50 text-amber-800 border-amber-300'
				};
			case 'not_ready':
				return {
					label: 'ยังไม่พร้อมเปิดใช้งาน (Not Ready)',
					icon: XCircle,
					classes: 'bg-rose-50 text-rose-800 border-rose-300'
				};
			case 'pending_improvement':
				return {
					label: 'อยู่ระหว่างปรับปรุง / รอตรวจซ้ำ',
					icon: Clock,
					classes: 'bg-blue-50 text-blue-800 border-blue-300'
				};
			default:
				return {
					label: 'ยังไม่ได้ประเมิน (Unassessed)',
					icon: HelpCircle,
					classes: 'bg-slate-100 text-slate-600 border-slate-300'
				};
		}
	});

	const Icon = $derived(config.icon);

	const sizeClasses = $derived(
		size === 'sm'
			? 'text-xs px-2 py-0.5 gap-1'
			: size === 'lg'
				? 'text-sm font-semibold px-3 py-1.5 gap-2'
				: 'text-xs font-medium px-2.5 py-1 gap-1.5'
	);
</script>

<span
	class="inline-flex items-center rounded-full border {config.classes} {sizeClasses} tabular-nums"
>
	<Icon class="size-3.5 shrink-0" />
	<span>{config.label}</span>
</span>
