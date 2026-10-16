<script lang="ts">
	import type { ReadinessTier, ShelterReadinessAssessmentDoc } from '../domain/readiness.types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import CopyPlus from '@lucide/svelte/icons/copy-plus';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { formatThaiShortDate } from '$lib/utils/date';

	interface Props {
		open: boolean;
		latestAssessment?: ShelterReadinessAssessmentDoc | null;
		onStartNew: (tier: ReadinessTier) => void;
		onStartPrefilled: (latest: ShelterReadinessAssessmentDoc) => void;
		onCancel: () => void;
	}

	let {
		open = $bindable(false),
		latestAssessment = null,
		onStartNew,
		onStartPrefilled,
		onCancel
	}: Props = $props();

	let startMode = $state<'new' | 'prefill'>('new');
	let selectedTier = $state<ReadinessTier>('local_admin');

	$effect(() => {
		if (open) {
			startMode = latestAssessment ? 'prefill' : 'new';
			selectedTier = latestAssessment?.tier ?? 'local_admin';
		}
	});

	function handleConfirm() {
		if (startMode === 'prefill' && latestAssessment) {
			onStartPrefilled(latestAssessment);
		} else {
			onStartNew(selectedTier);
		}
		open = false;
	}

	function formatDate(isoStr?: string): string {
		if (!isoStr) return '';
		return formatThaiShortDate(isoStr) || isoStr;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<div class="flex items-center gap-2 text-slate-800">
				<ShieldAlert class="size-5 text-sky-600" />
				<Dialog.Title class="text-base font-bold">เลือกรูปแบบการทำแบบประเมินความพร้อม</Dialog.Title>
			</div>
			<Dialog.Description class="pt-1 text-xs text-slate-500">
				เลือกวิธีเริ่มต้นการตรวจประเมินศูนย์พักพิงในรอบนี้
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-3">
			<!-- Option 1: คัดลอกจากรอบล่าสุด (ถ้ามี) -->
			{#if latestAssessment}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {startMode ===
					'prefill'
						? 'border-sky-500 bg-sky-50/70 ring-2 ring-sky-400/30'
						: 'border-slate-200 bg-white hover:border-slate-300'}"
				>
					<input
						type="radio"
						name="startMode"
						value="prefill"
						checked={startMode === 'prefill'}
						onchange={() => (startMode = 'prefill')}
						class="mt-1"
					/>
					<div class="space-y-1">
						<div class="flex items-center gap-1.5 text-xs font-bold text-slate-900">
							<CopyPlus class="size-4 text-sky-600" />
							<span>คัดลอกจากรอบล่าสุดมาตั้งต้น (แนะนำ)</span>
						</div>
						<p class="text-2xs leading-relaxed text-slate-600">
							ดึงผลการตรวจรอบวันที่ <strong
								>{formatDate(latestAssessment.submitted_at ?? latestAssessment.created_at)}</strong
							>
							({latestAssessment.tier === 'community'
								? 'ระดับชุมชน'
								: latestAssessment.tier === 'local_admin'
									? 'ระดับ อปท.'
									: 'ระดับเมือง'}) มาเป็นค่าเริ่มต้น
							เพื่อให้เดินตรวจปรับปรุงเฉพาะข้อที่มีการเปลี่ยนแปลงได้รวดเร็ว
						</p>
					</div>
				</label>
			{/if}

			<!-- Option 2: เริ่มต้นใหม่ฟอร์มว่าง -->
			<label
				class="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {startMode ===
				'new'
					? 'border-sky-500 bg-sky-50/70 ring-2 ring-sky-400/30'
					: 'border-slate-200 bg-white hover:border-slate-300'}"
			>
				<input
					type="radio"
					name="startMode"
					value="new"
					checked={startMode === 'new'}
					onchange={() => (startMode = 'new')}
					class="mt-1"
				/>
				<div class="flex-1 space-y-2">
					<div class="flex items-center gap-1.5 text-xs font-bold text-slate-900">
						<PlusCircle class="size-4 text-slate-700" />
						<span>เริ่มประเมินใหม่ทั้งหมด (ฟอร์มว่าง)</span>
					</div>
					<p class="text-2xs text-slate-600">
						สร้างแบบประเมินฉบับใหม่ที่ยังไม่มีการติ๊กเลือกข้อใด ๆ
					</p>

					<!-- Tier Selection (Active when new is chosen) -->
					{#if startMode === 'new'}
						<div class="space-y-1.5 border-t border-slate-200/80 pt-2">
							<Label class="text-2xs font-bold text-slate-700">
								เลือกระดับมาตรฐานของศูนย์พักพิง (Tier):
							</Label>
							<select
								bind:value={selectedTier}
								class="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs font-semibold text-slate-800 shadow-2xs focus:border-sky-500 focus:outline-hidden"
							>
								<option value="community">ระดับชุมชน (10+ คน / บ้านพัก 1-2 ชั้น)</option>
								<option value="local_admin">ระดับ อปท. (50–500 คน / วัด โรงเรียน มัสยิด)</option>
								<option value="city">ระดับเมือง (5,000+ คน / มหาวิทยาลัย ศูนย์ประชุม)</option>
							</select>
						</div>
					{/if}
				</div>
			</label>
		</div>

		<Dialog.Footer class="gap-2 sm:gap-0">
			<Button variant="outline" size="sm" onclick={onCancel}>ยกเลิก</Button>
			<Button
				size="sm"
				class="bg-sky-700 text-xs font-bold text-white hover:bg-sky-800"
				onclick={handleConfirm}
			>
				เริ่มต้นการประเมิน
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
