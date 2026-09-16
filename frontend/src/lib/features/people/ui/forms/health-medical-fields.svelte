<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import type { CareTrack } from '../../domain/people.js';

	let {
		care_track = $bindable<CareTrack>('normal'),
		conditions = $bindable<string>(''),
		medications = $bindable<string>(''),
		allergies = $bindable<string>(''),
		general_symptoms = $bindable<string>(''),
		disabled = false,
		idPrefix = 'med',
		showGeneralSymptoms = true
	}: {
		care_track?: CareTrack;
		conditions?: string;
		medications?: string;
		allergies?: string;
		general_symptoms?: string;
		disabled?: boolean;
		idPrefix?: string;
		showGeneralSymptoms?: boolean;
	} = $props();

	const careTrackOptions: { value: CareTrack; label: string; desc: string }[] = [
		{
			value: 'normal',
			label: 'ดูแลตามปกติ (Normal)',
			desc: 'ไม่มีภาวะเร่งด่วน จัดกลุ่มการดูแลตามปกติ'
		},
		{
			value: 'fast_track',
			label: 'Fast track',
			desc: 'มีภาวะเร่งด่วนหรือต้องการการติดตามอย่างใกล้ชิด'
		}
	];
</script>

<div class="space-y-5">
	<div class="space-y-1.5">
		<Label class="text-xs font-semibold text-foreground">แนวทางดูแล (Care Track)</Label>
		<RadioGroup.Root
			value={care_track}
			onValueChange={(v) => {
				if (v === 'normal' || v === 'fast_track') care_track = v;
			}}
			{disabled}
			class="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
		>
			{#each careTrackOptions as opt (opt.value)}
				{@const selected = care_track === opt.value}
				<label
					for="{idPrefix}-care-track-{opt.value}"
					class="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {selected
						? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary'
						: 'border-border bg-card hover:bg-muted/30'} {disabled
						? 'pointer-events-none opacity-60'
						: ''}"
				>
					<RadioGroup.Item
						value={opt.value}
						id="{idPrefix}-care-track-{opt.value}"
						class="mt-0.5"
					/>
					<div class="space-y-0.5">
						<span class="block text-xs font-semibold text-foreground">{opt.label}</span>
						<span class="block text-xs text-muted-foreground">{opt.desc}</span>
					</div>
				</label>
			{/each}
		</RadioGroup.Root>
	</div>

	<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
		<div class="space-y-1.5">
			<Label for="{idPrefix}-conditions" class="text-xs font-medium text-foreground">
				โรคประจำตัว
			</Label>
			<Textarea
				id="{idPrefix}-conditions"
				bind:value={conditions}
				{disabled}
				rows={3}
				placeholder="เช่น เบาหวาน, โรคหัวใจ, หอบหืด"
				class="text-xs"
			/>
		</div>

		<div class="space-y-1.5">
			<Label for="{idPrefix}-medications" class="text-xs font-medium text-foreground">
				ยาที่ใช้ประจำ
			</Label>
			<Textarea
				id="{idPrefix}-medications"
				bind:value={medications}
				{disabled}
				rows={3}
				placeholder="เช่น ยาลดความดัน, อินซูลิน"
				class="text-xs"
			/>
		</div>

		<div class="space-y-1.5">
			<Label for="{idPrefix}-allergies" class="text-xs font-medium text-foreground">
				ประวัติการแพ้
			</Label>
			<Textarea
				id="{idPrefix}-allergies"
				bind:value={allergies}
				{disabled}
				rows={3}
				placeholder="เช่น เพนิซิลลิน, อาหารทะเล"
				class="text-xs"
			/>
		</div>
	</div>

	{#if showGeneralSymptoms}
		<div class="space-y-1.5">
			<Label for="{idPrefix}-general-symptoms" class="text-xs font-medium text-foreground">
				อาการและข้อสังเกต
			</Label>
			<Textarea
				id="{idPrefix}-general-symptoms"
				bind:value={general_symptoms}
				{disabled}
				rows={3}
				placeholder="กรอกอาการทั่วไป เช่น ปวดศีรษะ เวียนศีรษะ ปวดเมื่อยตัว อ่อนเพลีย บาดแผล ฯลฯ (เว้นว่างได้ถ้าไม่มีอาการ)"
				class="text-xs"
			/>
		</div>
	{/if}
</div>
