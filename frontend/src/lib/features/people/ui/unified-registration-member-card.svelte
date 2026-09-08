<script lang="ts">
	import IdCard from '@lucide/svelte/icons/id-card';
	import Phone from '@lucide/svelte/icons/phone';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { CR112_VULNERABLE_GROUP_ACTIVE } from '$lib/features/master-data';
	import { PersonalInfoFields, EmergencyContactFields, SpecialNeedsFields } from './forms/index.js';
	import {
		applyAnonymousIdToMember,
		memberCardLabel,
		type UnifiedMemberInput
	} from '../domain/unified-registration';

	let {
		member = $bindable<UnifiedMemberInput>(),
		index,
		canRemove = false,
		disabled = false,
		onRemove
	}: {
		member: UnifiedMemberInput;
		index: number;
		canRemove?: boolean;
		disabled?: boolean;
		onRemove?: () => void;
	} = $props();

	const title = $derived(memberCardLabel(index));
	const isPrimary = $derived(index === 0);

	// Ensure nested shells exist for bindable form fields.
	if (!member.person_id) {
		member.person_id = { cardType: 'national_id', number: '' };
	}
	if (!member.emergency_contact) {
		member.emergency_contact = { name: '', phone: '', relation: '' };
	}
	if (!member.vulnerable_groups) member.vulnerable_groups = [];
	if (!member.special_needs) member.special_needs = [];
	if (member.last_name == null) member.last_name = '';
	if (member.country == null) member.country = 'THAILAND';
	if (member.religion == null) member.religion = 'unknown';
	if (member.gender == null) member.gender = 'other';

	let noPhone = $state(member.phone == null);
	let birthYear = $state<string | number | undefined>(
		typeof member.birth_year === 'number' || typeof member.birth_year === 'string'
			? member.birth_year
			: ''
	);
	let age = $state<string | number | undefined>(
		typeof member.age === 'number' || typeof member.age === 'string' ? member.age : ''
	);
	let emergency = $state({
		name: member.emergency_contact?.name ?? '',
		phone: member.emergency_contact?.phone ?? '',
		relation: member.emergency_contact?.relation ?? ''
	});

	$effect(() => {
		if (noPhone) {
			member.phone = null;
		} else if (member.phone == null) {
			member.phone = '';
		}
	});

	$effect(() => {
		const parsedBirth =
			typeof birthYear === 'string'
				? Number.parseInt(birthYear, 10)
				: typeof birthYear === 'number'
					? birthYear
					: Number.NaN;
		member.birth_year = Number.isFinite(parsedBirth) ? parsedBirth : undefined;
	});

	$effect(() => {
		const parsedAge =
			typeof age === 'string'
				? Number.parseInt(age, 10)
				: typeof age === 'number'
					? age
					: Number.NaN;
		member.age = Number.isFinite(parsedAge) ? parsedAge : undefined;
	});

	$effect(() => {
		member.emergency_contact = {
			name: emergency.name,
			phone: emergency.phone,
			relation: emergency.relation
		};
	});

	function applyAnonymous() {
		if (disabled) return;
		member = applyAnonymousIdToMember(member);
	}

	function toggleVulnerable(code: string) {
		if (disabled) return;
		const current = member.vulnerable_groups ?? [];
		member.vulnerable_groups = current.includes(code)
			? current.filter((c: string) => c !== code)
			: [...current, code];
	}
</script>

<section
	class="space-y-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
	aria-labelledby="member-card-title-{index}"
>
	<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
		<div>
			<h3 id="member-card-title-{index}" class="text-base font-bold text-foreground">
				{title}
			</h3>
			{#if isPrimary}
				<p class="text-xs text-muted-foreground">ผู้ติดต่อหลักของครอบครัว (ระบบตั้งค่าอัตโนมัติ)</p>
			{/if}
		</div>
		<div class="flex flex-wrap gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				{disabled}
				onclick={applyAnonymous}
				class="h-9 gap-1.5 text-xs"
			>
				<IdCard class="size-3.5" />
				ไม่มีบัตร / บุคคลนิรนาม
			</Button>
			{#if canRemove}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					{disabled}
					onclick={() => onRemove?.()}
					class="h-9 gap-1.5 text-xs text-destructive hover:text-destructive"
					aria-label="ลบสมาชิก"
				>
					<Trash2 class="size-3.5" />
					ลบ
				</Button>
			{/if}
		</div>
	</div>

	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<IdCard class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">ข้อมูลประจำตัว</h4>
		</div>
		<PersonalInfoFields
			bind:first_name={member.first_name}
			bind:last_name={member.last_name}
			bind:nickname={member.nickname}
			bind:person_id={member.person_id}
			bind:phone={member.phone}
			bind:no_phone={noPhone}
			bind:birth_year={birthYear}
			bind:age
			bind:gender={member.gender}
			bind:religion={member.religion}
			bind:country={member.country}
			{disabled}
		/>
	</div>

	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<Phone class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">ผู้ติดต่อฉุกเฉิน</h4>
		</div>
		<EmergencyContactFields
			bind:name={emergency.name}
			bind:phone={emergency.phone}
			bind:relation={emergency.relation}
			{disabled}
		/>
	</div>

	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<ShieldAlert class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">กลุ่มเปราะบาง</h4>
		</div>
		<Label class="sr-only">กลุ่มเปราะบาง</Label>
		<div class="flex flex-wrap gap-2">
			{#each CR112_VULNERABLE_GROUP_ACTIVE as item (item.code)}
				{@const checked = (member.vulnerable_groups ?? []).includes(item.code)}
				<Button
					type="button"
					variant="outline"
					{disabled}
					onclick={() => toggleVulnerable(item.code)}
					class="inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-normal transition-colors
					{checked
						? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
						: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
				>
					{item.label}
				</Button>
			{/each}
		</div>
	</div>

	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<HeartPulse class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">ความต้องการพิเศษ</h4>
		</div>
		<SpecialNeedsFields bind:special_needs={member.special_needs} {disabled} label="" />
	</div>
</section>
