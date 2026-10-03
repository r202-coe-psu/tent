<script lang="ts">
	import type { ReadinessItemStatus, ReadinessQuestionAnswer } from '../domain/readiness.types';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	interface Props {
		index: number;
		item: ReadinessQuestionAnswer;
		readOnly?: boolean;
		onChangeStatus: (newStatus: ReadinessItemStatus) => void;
		onChangeNote: (newNote: string) => void;
	}

	let { index, item, readOnly = false, onChangeStatus, onChangeNote }: Props = $props();

	let showNote = $state(false);

	$effect(() => {
		if (item.note) {
			showNote = true;
		}
	});

	function handleStatusChange(newStatus: ReadinessItemStatus) {
		onChangeStatus(newStatus);
		if (newStatus === 'none' || newStatus === 'partial') {
			showNote = true;
		}
	}

	function handleRemoveNote() {
		onChangeNote('');
		showNote = false;
	}

	const importanceConfig = $derived.by(() => {
		switch (item.importance) {
			case 'mandatory':
				return {
					label: 'จำเป็นต้องมี',
					badgeClass: 'bg-rose-50 text-rose-800 border-rose-200'
				};
			case 'recommended':
				return {
					label: 'สมควรจัดให้มี',
					badgeClass: 'bg-amber-50 text-amber-800 border-amber-200'
				};
			case 'optional':
				return {
					label: 'จัดให้มีหรือไม่มีก็ได้',
					badgeClass: 'bg-slate-100 text-slate-700 border-slate-200'
				};
		}
	});
</script>

<div
	class="rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs transition-colors hover:border-slate-300"
>
	<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
		<!-- Question Content -->
		<div class="flex-1 space-y-1">
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xs font-bold text-slate-700 tabular-nums"
				>
					{index}
				</span>
				<span
					class="inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-bold {importanceConfig.badgeClass}"
				>
					{importanceConfig.label}
				</span>
				<h4 class="text-sm leading-snug font-semibold text-slate-900">
					{item.title}
				</h4>
			</div>

			{#if item.description}
				<p class="pl-7 text-xs text-slate-500">
					{item.description}
				</p>
			{/if}
		</div>

		<!-- Status Selection Control -->
		<div class="flex shrink-0 items-center gap-1.5 self-start pt-1 md:pt-0">
			<!-- Option: มีครบ -->
			<button
				type="button"
				disabled={readOnly}
				onclick={() => handleStatusChange('fully_ready')}
				class="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all {item.status ===
				'fully_ready'
					? 'border-emerald-400 bg-emerald-50 font-bold text-emerald-800 shadow-2xs'
					: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
			>
				<span>✅ มีครบ</span>
			</button>

			<!-- Option: มีบางส่วน -->
			<button
				type="button"
				disabled={readOnly}
				onclick={() => handleStatusChange('partial')}
				class="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all {item.status ===
				'partial'
					? 'border-amber-400 bg-amber-50 font-bold text-amber-800 shadow-2xs'
					: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
			>
				<span>⚠️ มีบางส่วน</span>
			</button>

			<!-- Option: ไม่มี -->
			<button
				type="button"
				disabled={readOnly}
				onclick={() => handleStatusChange('none')}
				class="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all {item.status ===
				'none'
					? 'border-rose-400 bg-rose-50 font-bold text-rose-800 shadow-2xs'
					: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
			>
				<span>❌ ไม่มี</span>
			</button>
		</div>
	</div>

	<!-- Note Section -->
	<div class="mt-3 pl-7">
		{#if readOnly}
			{#if item.note}
				<div
					class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
				>
					<span class="font-semibold text-slate-800">หมายเหตุ:</span>
					{item.note}
				</div>
			{/if}
		{:else if showNote}
			<div class="flex items-center gap-1.5">
				<input
					type="text"
					value={item.note ?? ''}
					oninput={(e) => onChangeNote((e.currentTarget as HTMLInputElement).value)}
					placeholder="ระบุข้อสังเกต หรือสิ่งที่ต้องจัดหาเพิ่มเติม..."
					class="h-8 w-full rounded-md border border-slate-200 bg-slate-50/70 px-3 text-xs text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-hidden"
				/>
				<button
					type="button"
					onclick={handleRemoveNote}
					title="ลบหมายเหตุ"
					class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-2xs font-medium text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50"
				>
					<Trash2 class="size-3.5" />
					<span>ลบ</span>
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={() => (showNote = true)}
				class="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-200/90 bg-slate-50/40 px-3 py-1.5 text-left text-2xs font-medium text-slate-400 transition-all hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-700"
			>
				<MessageSquare class="size-3.5 shrink-0" />
				<span>+ เพิ่มหมายเหตุสำหรับข้อนี้...</span>
			</button>
		{/if}
	</div>
</div>
