<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
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

	const bloodGroupOptions: { value: BloodGroup; label: string }[] = [
		{ value: 'unknown', label: 'ไม่ระบุ' },
		{ value: 'A', label: 'A' },
		{ value: 'B', label: 'B' },
		{ value: 'AB', label: 'AB' },
		{ value: 'O', label: 'O' }
	];

	const careTrackOptions: { value: CareTrack; label: string }[] = [
		{ value: 'normal', label: 'ดูแลตามปกติ' },
		{ value: 'fast_track', label: 'Fast track' }
	];

	const triageOptions: {
		level: 'green' | 'yellow' | 'red';
		label: string;
		desc: string;
		badgeClass: string;
		activeClass: string;
	}[] = [
		{
			level: 'green',
			label: 'สีเขียว (Green)',
			desc: 'อาการทั่วไป / ปกติ',
			badgeClass: 'bg-emerald-500',
			activeClass:
				'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
		},
		{
			level: 'yellow',
			label: 'สีเหลือง (Yellow)',
			desc: 'เฝ้าระวัง / อาการปานกลาง',
			badgeClass: 'bg-amber-500',
			activeClass:
				'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
		},
		{
			level: 'red',
			label: 'สีแดง (Red)',
			desc: 'เร่งด่วน / วิกฤต / ต้องส่งต่อ',
			badgeClass: 'bg-red-500',
			activeClass: 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200'
		}
	];

	function selectTriage(level: 'green' | 'yellow' | 'red') {
		if (disabled) return;
		triage_level = level;
		if (level === 'red') {
			referral = true;
			care_track = 'fast_track';
		} else if (level === 'yellow') {
			care_track = 'fast_track';
		}
	}
</script>

<div class="space-y-5">
	<!-- Summary / Triage & Track Section -->
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<div>
				<h4 class="text-xs font-semibold text-foreground">ระดับความเร่งด่วน (Triage Level)</h4>
				<p class="text-2xs text-muted-foreground">ประเมินระดับการคัดกรองเพื่อการจัดลำดับการดูแล</p>
			</div>
			{#if referral}
				<span
					class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
				>
					<AlertTriangle class="size-3" /> ต้องส่งต่อ
				</span>
			{/if}
		</div>

		<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
			{#each triageOptions as opt (opt.level)}
				{@const selected = triage_level === opt.level}
				<button
					type="button"
					{disabled}
					onclick={() => selectTriage(opt.level)}
					class="flex flex-col items-start rounded-lg border p-2.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 {selected
						? opt.activeClass
						: 'border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
				>
					<div class="flex items-center gap-2">
						<span class="size-2.5 rounded-full {opt.badgeClass}"></span>
						<span class="text-xs font-bold">{opt.label}</span>
					</div>
					<span class="mt-1 text-2xs">{opt.desc}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Blood group & Care track -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">หมู่เลือด</Label>
			<Select.Root
				type="single"
				value={blood_group}
				onValueChange={(val) => {
					if (val === 'unknown' || val === 'A' || val === 'B' || val === 'AB' || val === 'O') {
						blood_group = val;
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{bloodGroupOptions.find((o) => o.value === blood_group)?.label ?? 'ไม่ระบุ'}
				</Select.Trigger>
				<Select.Content>
					{#each bloodGroupOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">แนวทางดูแล</Label>
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
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{careTrackOptions.find((o) => o.value === care_track)?.label ?? 'ดูแลตามปกติ'}
				</Select.Trigger>
				<Select.Content>
					{#each careTrackOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
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

	<!-- Referral Switch & Notes -->
	<div class="space-y-3 border-t border-border pt-3">
		<div class="flex items-center justify-between">
			<div>
				<Label class="text-xs font-semibold text-foreground">สถานะการส่งต่อ (Referral)</Label>
				<p class="text-2xs text-muted-foreground">
					ส่งต่อพบแพทย์หรือโรงพยาบาลสนามเพื่อประเมินเพิ่มเติม
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="สถานะการส่งต่อ"
				aria-checked={referral}
				{disabled}
				onclick={() => {
					if (disabled) return;
					referral = !referral;
				}}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 {referral
					? 'bg-amber-600'
					: 'bg-muted-foreground/30'}"
			>
				<span
					class="pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out {referral
						? 'translate-x-5'
						: 'translate-x-0'}"
				></span>
			</button>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
	</div>
</div>
