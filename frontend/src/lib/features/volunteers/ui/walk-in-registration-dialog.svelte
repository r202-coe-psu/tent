<script lang="ts">
	/**
	 * "ลงทะเบียนอาสาสมัคร Walk-in ด่วน" (CR-094 FR-VOL-10.1/10.5, owner-approved
	 * mockup 2026-08-28).
	 *
	 * `volunteer.first_name`/`last_name` are separate required fields
	 * (schema.md §2.8) and are entered as two separate fields here.
	 *
	 * "สังกัดศูนย์พักพิง" is locked to the active shelter, not a real picker —
	 * `volunteerRepository().create()` always writes to the active shelter's
	 * CouchDB (`getShelterDb()`), so there is nowhere else this profile could
	 * be created into.
	 *
	 * The instant check-in checkbox calls `useSetVolunteerCheckedIn` (flips
	 * `volunteer.checked_in` directly) AFTER the volunteer is created — it does
	 * NOT create a `shift_assignment`, because that requires a `job_id`
	 * (`shiftAssignmentInputSchema`) and a walk-in registration has no job
	 * context here. That means this volunteer will show as checked-in without
	 * a station/duty_window, and will not appear in `shift_assignment`-based
	 * counters (`domain/hub-metrics.ts` `assigned`/`checkedInNow` — those read
	 * `shift_assignment.status` only). Flagged for the CR: walk-in "ready
	 * now" needs either an adhoc/no-job shift_assignment path or a documented
	 * decision that it only ever sets the volunteer flag.
	 *
	 * `identity_verified` is left at the domain factory's default (`false`,
	 * `makeVolunteer`) even though staff are presumably checking an ID card in
	 * person at the desk — also flagged for the CR (should `source: 'walk_in'`
	 * / `'staff_entry'` auto-verify identity?).
	 */
	import { defaults, superForm, setError } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Zap from '@lucide/svelte/icons/zap';
	import Check from '@lucide/svelte/icons/check';
	import Lock from '@lucide/svelte/icons/lock';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { SKILL_MASTER } from '../domain/skill-master';
	import {
		walkInVolunteerFormSchema,
		type WalkInVolunteerFormValues
	} from '../domain/volunteer.schema';
	import type { ShiftKind } from '../domain/shift-assignment.schema';
	import { useCreateWalkInVolunteer, useSetVolunteerCheckedIn } from '../application/queries';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const queryClient = useQueryClient();
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const shelterLabel = $derived(shelterQuery.data?.name ?? shelterCode);

	function emptyValues(): WalkInVolunteerFormValues {
		return { first_name: '', last_name: '', phone: '', email: '', national_id: '' };
	}

	let selectedSkills = $state<string[]>([]);
	let shift = $state<Exclude<ShiftKind, 'custom'>>('morning');
	let instantCheckIn = $state(true);

	const SHIFT_TILES: { value: Exclude<ShiftKind, 'custom'>; label: string; time: string }[] = [
		{ value: 'morning', label: 'กะเช้า', time: '08:00 - 16:00' },
		{ value: 'afternoon', label: 'กะบ่าย', time: '16:00 - 00:00' },
		{ value: 'night', label: 'กะดึก', time: '00:00 - 08:00' },
		{ value: 'flex', label: 'ยืดหยุ่น', time: 'สแตนด์บายด่วน' }
	];

	function toggleSkill(key: string) {
		selectedSkills = selectedSkills.includes(key)
			? selectedSkills.filter((s) => s !== key)
			: [...selectedSkills, key];
	}

	const createMutation = useCreateWalkInVolunteer(queryClient);
	const checkInMutation = useSetVolunteerCheckedIn(queryClient);

	const form = superForm(defaults(emptyValues(), zod4(walkInVolunteerFormSchema)), {
		warnings: { duplicateId: false },
		SPA: true,
		dataType: 'json',
		validators: zod4(walkInVolunteerFormSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) return;
			const data = validated.data;

			try {
				const volunteer = await createMutation.mutateAsync({
					first_name: data.first_name,
					last_name: data.last_name,
					phone: data.phone,
					email: data.email || null,
					skills: selectedSkills,
					organization: null,
					national_id: data.national_id || null,
					source: 'walk_in'
				});

				if (instantCheckIn) {
					await checkInMutation.mutateAsync({
						id: volunteer._id,
						checkedIn: true,
						shelterCode
					});
				}

				toast.success(
					`ลงทะเบียน ${data.first_name} ${data.last_name} (${volunteer.volunteer_code}) แล้ว`
				);
				reset();
				open = false;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'ลงทะเบียนไม่สำเร็จ';
				setError(validated, message);
				toast.error(message);
			}
		}
	});

	const { form: formData, errors, submitting } = form;

	function reset() {
		$formData = emptyValues();
		selectedSkills = [];
		shift = 'morning';
		instantCheckIn = true;
	}

	const isPending = $derived($submitting || createMutation.isPending || checkInMutation.isPending);
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) reset();
	}}
>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div class="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
				<Zap class="h-4.5 w-4.5" />
			</div>
			<div>
				<Dialog.Title class="text-base font-bold">ลงทะเบียนอาสาสมัคร Walk-in ด่วน</Dialog.Title>
				<p class="text-xs text-muted-foreground">
					Fast 30-Sec Front-desk Registration &amp; Instant Shift Assign
				</p>
			</div>
		</div>

		<form method="POST" use:form.enhance class="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
			<div class="space-y-3">
				<p class="text-xs font-bold text-foreground">1. ข้อมูลบุคคล (PERSONAL INFO)</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Form.Field {form} name="first_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อ <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									bind:value={$formData.first_name}
									placeholder="เช่น สมชาย"
									class="h-11"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="last_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>นามสกุล <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									bind:value={$formData.last_name}
									placeholder="เช่น ใจดี"
									class="h-11"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
				<Form.Field {form} name="phone">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เบอร์โทรศัพท์ <span class="text-destructive">*</span></Form.Label>
							<Input
								{...props}
								bind:value={$formData.phone}
								placeholder="08X-XXX-XXXX"
								class="h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="email">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>อีเมล (ทางเลือก / Optional)</Form.Label>
							<Input
								{...props}
								type="email"
								bind:value={$formData.email}
								placeholder="เช่น somchai@example.com (ไม่บังคับ)"
								class="h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="national_id">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เลขบัตร ปชช. (13 หลัก) (ทางเลือก / Optional)</Form.Label>
							<Input
								{...props}
								bind:value={$formData.national_id}
								oninput={(e) => {
									$formData.national_id = e.currentTarget.value.replace(/\D/g, '').slice(0, 13);
								}}
								inputmode="numeric"
								maxlength={13}
								placeholder="X-XXXX-XXXXX-XX-X (ไม่บังคับ)"
								class="h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<div class="space-y-1.5">
					<Label>สังกัดศูนย์พักพิง <span class="text-destructive">*</span></Label>
					<Select.Root type="single" value={shelterCode} disabled>
						<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
							<span class="flex items-center gap-1.5 truncate">
								<Lock class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{shelterLabel}
							</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={shelterCode} label={shelterLabel} />
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<p class="text-xs font-bold text-foreground">2. ทักษะทั่วไป (SKILLS) — แตะเพื่อเลือก</p>
					<span class="text-xs text-muted-foreground">เลือกแล้ว {selectedSkills.length} ทักษะ</span>
				</div>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each SKILL_MASTER.filter((s) => !s.controlled) as skill (skill.key)}
						{@const checked = selectedSkills.includes(skill.key)}
						<button
							type="button"
							onclick={() => toggleSkill(skill.key)}
							aria-pressed={checked}
							class="flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs font-medium transition-colors {checked
								? 'border-primary bg-primary/5 text-primary'
								: 'border-border text-foreground hover:bg-muted/40'}"
						>
							<span class="text-lg" aria-hidden="true">{skill.icon}</span>
							{skill.label}
						</button>
					{/each}
				</div>

				{#each SKILL_MASTER.filter((s) => s.controlled) as skill (skill.key)}
					{@const checked = selectedSkills.includes(skill.key)}
					<label
						class="flex cursor-pointer items-start gap-2 rounded-xl border p-3 {checked
							? 'border-amber-300 bg-amber-50'
							: 'border-border'}"
					>
						<Checkbox {checked} onCheckedChange={() => toggleSkill(skill.key)} class="mt-0.5" />
						<span class="min-w-0 flex-1 text-xs">
							<span class="flex flex-wrap items-center gap-1.5 font-medium">
								<span aria-hidden="true">{skill.icon}</span>
								{skill.label}
								<Badge variant="outline" class="gap-1 border-amber-300 text-[10px] text-amber-700">
									<Lock class="h-2.5 w-2.5" />
									ต้องรอรับรอง
								</Badge>
							</span>
							<span class="mt-0.5 block text-[11px] text-muted-foreground">
								สำหรับผู้มีใบประกอบวิชาชีพทางการแพทย์ / พยาบาล
							</span>
						</span>
					</label>
				{/each}
			</div>

			<div class="space-y-2">
				<p class="text-xs font-bold text-foreground">
					3. เลือกกะงาน &amp; เริ่มปฏิบัติงาน (SHIFT &amp; READY)
				</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each SHIFT_TILES as tile (tile.value)}
						<button
							type="button"
							onclick={() => (shift = tile.value)}
							aria-pressed={shift === tile.value}
							class="flex flex-col items-center gap-0.5 rounded-xl border p-3 text-center text-xs font-bold transition-colors {shift ===
							tile.value
								? 'border-primary-dark bg-primary-dark text-white'
								: 'border-border text-foreground hover:bg-muted/40'}"
						>
							{tile.label}
							<span class="text-[10px] font-normal opacity-70">{tile.time}</span>
						</button>
					{/each}
				</div>

				<label
					class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 {instantCheckIn
						? 'border-emerald-300 bg-emerald-50'
						: 'border-border'}"
				>
					<Checkbox
						checked={instantCheckIn}
						onCheckedChange={(v) => (instantCheckIn = !!v)}
						class="mt-0.5"
					/>
					<span class="min-w-0 text-xs">
						<span class="font-medium text-foreground">เช็คอินเข้ากะและเริ่มปฏิบัติงานทันที</span>
						<span class="mt-0.5 block text-[11px] text-muted-foreground">
							บันทึกสถานะเป็น "พร้อมปฏิบัติงาน" และเช็กอินงานทันทีโดยเจ้าหน้าที่หน้างาน
						</span>
					</span>
				</label>
			</div>

			{#if $errors._errors && $errors._errors.length > 0}
				<p
					class="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
				>
					{$errors._errors.join(', ')}
				</p>
			{/if}
		</form>

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				type="submit"
				class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				disabled={isPending}
				onclick={() => form.submit()}
			>
				{#if isPending}
					กำลังบันทึก...
				{:else}
					<Check class="h-4 w-4" />
					ยืนยันและเริ่มปฏิบัติงานทันที
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
