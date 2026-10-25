<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { MasterTagInput, resolveMasterCodes, useMasterData } from '$lib/features/master-data';
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

	// CR-186 / #648 — โรคประจำตัว and ประวัติการแพ้ pick from masters `chronic_disease` /
	// `allergy`; both stay comma-separated strings of codes / free text so parents
	// keep their split(',').
	// Parents still map legacy labels on save (FR-7) — this getter only shows them.
	const chronicDiseaseQuery = useMasterData(() => 'chronic_disease');
	const chronicDiseaseItems = $derived(chronicDiseaseQuery.data?.items ?? []);
	const allergyQuery = useMasterData(() => 'allergy');
	const allergyItems = $derived(allergyQuery.data?.items ?? []);

	function getConditionTokens(): string[] {
		return resolveMasterCodes(conditions.split(','), chronicDiseaseItems);
	}

	function setConditionTokens(tokens: string[]) {
		conditions = tokens.join(', ');
	}

	function getAllergyTokens(): string[] {
		return resolveMasterCodes(allergies.split(','), allergyItems);
	}

	function setAllergyTokens(tokens: string[]) {
		allergies = tokens.join(', ');
	}

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

	<!-- โรคประจำตัว gets a full-width row so its tags flow on one line (CR-186). -->
	<div class="space-y-1.5">
		<Label for="{idPrefix}-conditions" class="text-xs font-medium text-foreground">
			โรคประจำตัว
		</Label>
		<MasterTagInput
			id="{idPrefix}-conditions"
			bind:value={getConditionTokens, setConditionTokens}
			items={chronicDiseaseItems}
			{disabled}
			placeholder="เลือกหรือพิมพ์ เช่น เบาหวาน, โรคหัวใจ"
			searchPlaceholder="ค้นหาโรคประจำตัว..."
			listLabel="โรคประจำตัวที่เลือก"
		/>
	</div>

	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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
			<MasterTagInput
				id="{idPrefix}-allergies"
				bind:value={getAllergyTokens, setAllergyTokens}
				items={allergyItems}
				{disabled}
				placeholder="เลือกหรือพิมพ์ เช่น อาหารทะเล, เพนิซิลลิน"
				searchPlaceholder="ค้นหาสิ่งที่แพ้..."
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
