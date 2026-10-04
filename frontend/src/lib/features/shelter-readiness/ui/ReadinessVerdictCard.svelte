<script lang="ts">
	import type { Component } from 'svelte';
	import type { ReadinessSummaryTally, ReadinessVerdict } from '../domain/readiness.types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface Props {
		summary: ReadinessSummaryTally;
		selectedVerdict: ReadinessVerdict | null;
		justificationNote: string;
		submitting?: boolean;
		readOnly?: boolean;
		onSelectVerdict: (verdict: ReadinessVerdict) => void;
		onChangeNote: (note: string) => void;
		onSubmitVerdict: () => void;
	}

	let {
		summary,
		selectedVerdict,
		justificationNote = $bindable(''),
		submitting = false,
		readOnly = false,
		onSelectVerdict,
		onChangeNote,
		onSubmitVerdict
	}: Props = $props();

	const verdictOptions: {
		id: ReadinessVerdict;
		label: string;
		subtext: string;
		icon: Component;
		borderClass: string;
		bgActive: string;
		textActive: string;
	}[] = [
		{
			id: 'ready',
			label: 'พร้อมเปิดใช้งาน (Ready)',
			subtext: 'องค์ประกอบจำเป็นมีครบถ้วน สามารถรองรับผู้ประสบภัยได้อย่างปลอดภัย',
			icon: CheckCircle2,
			borderClass: 'border-emerald-300',
			bgActive: 'bg-emerald-50 text-emerald-900 border-emerald-500 ring-2 ring-emerald-400/40',
			textActive: 'text-emerald-700'
		},
		{
			id: 'conditional_pass',
			label: 'พร้อมแบบมีเงื่อนไข (Conditional)',
			subtext: 'มีบางส่วนที่ต้องบริหารจัดการชดเชย แต่สามารถเปิดบริการขั้นต้นได้',
			icon: AlertTriangle,
			borderClass: 'border-amber-300',
			bgActive: 'bg-amber-50 text-amber-900 border-amber-500 ring-2 ring-amber-400/40',
			textActive: 'text-amber-700'
		},
		{
			id: 'not_ready',
			label: 'ยังไม่พร้อมเปิดใช้งาน (Not Ready)',
			subtext: 'ขาดองค์ประกอบสำคัญด้านความปลอดภัยขั้นพื้นฐาน ไม่ควรเปิดรับผู้พักพิง',
			icon: XCircle,
			borderClass: 'border-rose-300',
			bgActive: 'bg-rose-50 text-rose-900 border-rose-500 ring-2 ring-rose-400/40',
			textActive: 'text-rose-700'
		},
		{
			id: 'pending_improvement',
			label: 'อยู่ระหว่างปรับปรุง / รอตรวจซ้ำ',
			subtext: 'อยู่ระหว่างแก้ไขจุดบกพร่องตามคำแนะนำ และนัดตรวจรับรองรอบใหม่',
			icon: Clock,
			borderClass: 'border-blue-300',
			bgActive: 'bg-blue-50 text-blue-900 border-blue-500 ring-2 ring-blue-400/40',
			textActive: 'text-blue-700'
		}
	];

	const canSubmit = $derived(
		selectedVerdict !== null && justificationNote.trim().length > 0 && !submitting
	);
</script>

<Card.Root class="border-2 border-slate-300 bg-white shadow-sm">
	<Card.Header class="border-b border-slate-100 bg-slate-50/60 pb-3">
		<div class="flex items-center gap-2 text-slate-800">
			<ShieldCheck class="size-5 text-sky-700" />
			<Card.Title class="text-base font-bold">
				การสรุปและตัดสินผลการตรวจประเมินความพร้อม (Final Verdict)
			</Card.Title>
		</div>
		<Card.Description class="text-xs text-slate-500">
			ผู้ตรวจประเมินเป็นผู้ตัดสินใจเลือกผลลัพธ์สุดท้าย
			พร้อมระบุเหตุผลหรือมาตรการชดเชยตามสภาพหน้างานจริง
		</Card.Description>
	</Card.Header>

	<Card.Content class="space-y-5 pt-4">
		<!-- Summary Cards Row -->
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
			<div class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-center">
				<span class="block text-2xs font-semibold text-emerald-800">มีครบ</span>
				<span class="text-xl font-bold text-emerald-700 tabular-nums"
					>{summary.fully_ready_count}</span
				>
				<span class="text-2xs text-emerald-600">ข้อ</span>
			</div>
			<div class="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-center">
				<span class="block text-2xs font-semibold text-amber-800">มีบางส่วน</span>
				<span class="text-xl font-bold text-amber-700 tabular-nums">{summary.partial_count}</span>
				<span class="text-2xs text-amber-600">ข้อ</span>
			</div>
			<div class="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-center">
				<span class="block text-2xs font-semibold text-rose-800">ไม่มี</span>
				<span class="text-xl font-bold text-rose-700 tabular-nums">{summary.none_count}</span>
				<span class="text-2xs text-rose-600">ข้อ</span>
			</div>
			<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
				<span class="block text-2xs font-semibold text-slate-600">ยังไม่ตรวจ</span>
				<span class="text-xl font-bold text-slate-700 tabular-nums">{summary.unassessed_count}</span
				>
				<span class="text-2xs text-slate-500">ข้อ</span>
			</div>
		</div>

		<!-- Warning for unassessed items -->
		{#if summary.unassessed_count > 0}
			<div
				class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900"
			>
				<AlertTriangle class="size-4 shrink-0 text-amber-600" />
				<span>
					ยังมีคำถามที่ยังไม่ได้ตรวจจำนวน <strong>{summary.unassessed_count}</strong> ข้อ (คุณสามารถยืนยันผลได้
					แต่ต้องระบุเหตุผลประกอบในช่องด้านล่าง)
				</span>
			</div>
		{/if}

		<!-- Verdict Options Selection -->
		<div class="space-y-2">
			<Label class="text-xs font-bold text-slate-800">
				ผลการตัดสินความพร้อมศูนย์พักพิง (เลือก 1 รายการ)
			</Label>

			<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				{#each verdictOptions as opt (opt.id)}
					{@const Icon = opt.icon}
					{@const isSelected = selectedVerdict === opt.id}
					<button
						type="button"
						disabled={readOnly}
						onclick={() => onSelectVerdict(opt.id)}
						class="flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all {isSelected
							? opt.bgActive
							: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}"
					>
						<Icon class="size-5 shrink-0 pt-0.5 {opt.textActive}" />
						<div class="space-y-0.5">
							<span class="block text-xs font-bold text-slate-900">{opt.label}</span>
							<span class="block text-2xs leading-relaxed text-slate-600">{opt.subtext}</span>
						</div>
					</button>
				{/each}
			</div>
		</div>

		<!-- Justification Note Textarea -->
		<div class="space-y-1.5">
			<Label class="text-xs font-bold text-slate-800">
				เหตุผลประกอบการตัดสินใจ / มาตรการชดเชยรองรับความเสี่ยง <span class="text-rose-500">*</span>
			</Label>
			<Textarea
				disabled={readOnly}
				value={justificationNote}
				oninput={(e) => onChangeNote((e.currentTarget as HTMLTextAreaElement).value)}
				placeholder="ระบุข้อเท็จจริงหน้างาน เหตุผลที่ตัดสินผ่านหรือมีเงื่อนไข เช่น 'ได้รับการสนับสนุนเครื่องปั่นไฟสำรองจาก อปท. ข้างเคียงแล้ว กำลังเดินทางมาถึงก่อนเริ่มรับผู้อพยพ'..."
				rows={3}
				class="text-xs"
			/>
		</div>
	</Card.Content>

	<!-- Action Footer -->
	{#if !readOnly}
		<Card.Footer
			class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 pt-4"
		>
			<span class="text-2xs text-slate-500">
				* เมื่อกดยืนยันผลการประเมิน ข้อมูลจะถูกบันทึกเป็น Snapshot ประวัติ และไม่สามารถแก้ไขทับได้
			</span>

			<Button
				onclick={onSubmitVerdict}
				disabled={!canSubmit}
				class="min-h-10 gap-2 bg-sky-700 px-5 text-xs font-bold text-white shadow-2xs hover:bg-sky-800"
			>
				{#if submitting}
					<Loader2 class="size-4 animate-spin" />
					กำลังยืนยันผล...
				{:else}
					<ShieldCheck class="size-4" />
					ยืนยันผลการประเมิน (Submit Verdict)
				{/if}
			</Button>
		</Card.Footer>
	{/if}
</Card.Root>
