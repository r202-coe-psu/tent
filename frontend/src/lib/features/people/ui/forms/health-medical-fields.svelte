<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { BloodGroup, CareTrack } from '$lib/features/people';

	let {
		blood_group = $bindable<BloodGroup>('unknown'),
		conditions = $bindable<string>(''),
		medications = $bindable<string>(''),
		allergies = $bindable<string>(''),
		medical_notes = $bindable<string>(''),
		triage_level = $bindable<'green' | 'yellow' | 'red'>('green'),
		care_track = $bindable<CareTrack>('normal'),
		screening_notes = $bindable<string>(''),
		referral = $bindable<boolean>(false),
		disabled = false
	}: {
		blood_group?: BloodGroup;
		conditions?: string;
		medications?: string;
		allergies?: string;
		medical_notes?: string;
		triage_level?: 'green' | 'yellow' | 'red';
		care_track?: CareTrack;
		screening_notes?: string;
		referral?: boolean;
		disabled?: boolean;
	} = $props();

	const careTrackOptions: { value: CareTrack; label: string }[] = [
		{ value: 'normal', label: 'ดูแลตามปกติ' },
		{ value: 'fast_track', label: 'Fast track' }
	];

	// Deprecated fields retained for caller compatibility
	void blood_group;
	void triage_level;
	void referral;
</script>

<div class="space-y-5">
	<!-- Care track -->
	<div class="space-y-1.5">
		<Label class="text-xs font-semibold text-foreground">แนวทางดูแล (Care Track)</Label>
		<Select.Root
			type="single"
			value={care_track}
			onValueChange={(val) => {
				if (val === 'normal' || val === 'fast_track') {
					care_track = val;
				}
			}}
			{disabled}
		>
			<Select.Trigger class="!h-9 w-full max-w-xs rounded-md text-xs">
				{careTrackOptions.find((o) => o.value === care_track)?.label ?? 'ดูแลตามปกติ'}
			</Select.Trigger>
			<Select.Content>
				{#each careTrackOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Medical History (Conditions, Medications, Allergies) -->
	<div class="space-y-3 border-t border-border pt-3">
		<h4 class="text-xs font-semibold text-foreground">ประวัติสุขภาพและโรคประจำตัว</h4>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-1.5">
				<Label for="med-conditions" class="text-xs text-muted-foreground">โรคประจำตัว</Label>
				<Textarea
					id="med-conditions"
					bind:value={conditions}
					{disabled}
					rows={3}
					placeholder="เช่น เบาหวาน, ความดันโลหิตสูง"
					class="text-xs"
				/>
			</div>

			<div class="space-y-1.5">
				<Label for="med-medications" class="text-xs text-muted-foreground">ยาที่ใช้ประจำ</Label>
				<Textarea
					id="med-medications"
					bind:value={medications}
					{disabled}
					rows={3}
					placeholder="เช่น ยาลดความดัน, อินซูลิน"
					class="text-xs"
				/>
			</div>

			<div class="space-y-1.5">
				<Label for="med-allergies" class="text-xs text-muted-foreground">ประวัติการแพ้</Label>
				<Textarea
					id="med-allergies"
					bind:value={allergies}
					{disabled}
					rows={3}
					placeholder="เช่น เพนิซิลลิน, อาหารทะเล"
					class="text-xs"
				/>
			</div>
		</div>
	</div>

	<!-- Notes (if used) -->
	{#if screening_notes !== undefined || medical_notes !== undefined}
		<div class="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="screening-notes" class="text-xs text-muted-foreground">บันทึกการคัดกรอง</Label>
				<Textarea
					id="screening-notes"
					bind:value={screening_notes}
					{disabled}
					rows={2}
					placeholder="ข้อสังเกตเบื้องต้นสำหรับทีมดูแล"
					class="text-xs"
				/>
			</div>

			<div class="space-y-1.5">
				<Label for="medical-notes" class="text-xs text-muted-foreground"
					>บันทึกการดูแลต่อเนื่อง</Label
				>
				<Textarea
					id="medical-notes"
					bind:value={medical_notes}
					{disabled}
					rows={2}
					placeholder="ข้อมูลการติดตามระหว่างพักพิง"
					class="text-xs"
				/>
			</div>
		</div>
	{/if}
</div>
