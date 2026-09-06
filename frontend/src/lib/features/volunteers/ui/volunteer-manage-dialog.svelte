<script lang="ts">
	/**
	 * "จัดการข้อมูลอาสาสมัคร" — People roster row management dialog
	 * (owner-approved mockup, 2026-08-29). Opened from `volunteer-card.svelte`'s
	 * per-row "จัดการข้อมูล" button.
	 *
	 * Scope split (mirrors `volunteer-card.svelte`'s header comment): ชื่อ-นามสกุล
	 * / เบอร์โทรศัพท์ / ทักษะทั่วไป / ชนิดบุคคล are real edits through
	 * `VolunteerRepository#update()` (`useUpdateVolunteer`, LWW read-modify-write) —
	 * ชนิดบุคคล backed by `volunteer.personnel_type` (CR-095, schema_v 2 → 3).
	 * Everything else here has no backing repository method yet, so it stays a
	 * UI-only stub that toasts, same convention as the rest of the card:
	 *   - กะที่มอบหมาย (ASSIGNED SHIFT): lives on `shift_assignment` (via job
	 *     dispatch), not on `volunteer` — there is no "set default shift" call.
	 *   - ออกสิทธิ์เข้าใช้งานระบบหลังบ้าน: no RoleKey-grant repository call
	 *     exists yet (FR-VOL-05R).
	 *   - ตรวจสอบ/รับรองทักษะควบคุม: no `verifyIdentity`-shaped repository
	 *     method exists yet.
	 * All flagged for the CR alongside the same schema gaps `volunteer-card.svelte`
	 * already flags.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import Check from '@lucide/svelte/icons/check';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { useUpdateVolunteer, useSkillOptions } from '../application/queries';
	import { isControlledSkill } from '../domain/skills';
	import { toSkillCode, toSkillCodes } from '../domain/skill-catalog';
	import type { PersonnelType, Volunteer } from '../domain/volunteer.schema';
	import type { ShiftKind } from '../domain/shift-assignment.schema';

	let {
		open = $bindable(false),
		volunteer,
		shelterLine,
		todayShift
	}: {
		open?: boolean;
		volunteer: Volunteer;
		shelterLine: string;
		todayShift: ShiftKind | null | undefined;
	} = $props();

	const queryClient = useQueryClient();
	const updateMutation = useUpdateVolunteer(queryClient);

	// Master Data `volunteer_skills`, effective for this shelter (CR-100) —
	// the same source used by the job and walk-in forms.
	const skillCatalog = useSkillOptions();
	const skillsList = $derived(skillCatalog.options);

	function stub(label: string) {
		toast.info(`${label} — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา`);
	}

	const SHIFT_TILES: { value: ShiftKind | 'unset'; label: string }[] = [
		{ value: 'unset', label: 'ไม่ระบุ' },
		{ value: 'morning', label: 'กะเช้า (08-16)' },
		{ value: 'afternoon', label: 'กะบ่าย (16-00)' },
		{ value: 'night', label: 'กะดึก (00-08)' },
		{ value: 'flex', label: 'กะอิสระ' }
	];

	let fullName = $state('');
	let phone = $state('');
	let selectedSkills = $state<string[]>([]);
	let personnelType = $state<PersonnelType>('volunteer');
	let assignedShift = $state<ShiftKind | 'unset'>('unset');

	// Rehydrate from the volunteer prop each time the dialog opens on a
	// (possibly different) row — mirrors `job-form-dialog.svelte`'s `lastOpenedKey`.
	let lastOpenedId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		fullName = `${volunteer.first_name} ${volunteer.last_name}`.trim();
		phone = volunteer.phone ?? '';
		selectedSkills = toSkillCodes(volunteer.skills, skillsList);
		personnelType = volunteer.personnel_type;
		assignedShift = todayShift ?? 'unset';
		lastOpenedId = volunteer._id;
	});

	function toggleSkill(code: string) {
		const canonicalCode = toSkillCode(code, skillsList);
		selectedSkills = selectedSkills.includes(canonicalCode)
			? selectedSkills.filter((s) => s !== canonicalCode)
			: [...selectedSkills, canonicalCode];
	}

	const generalSelectedCount = $derived(
		selectedSkills.filter((s) => !isControlledSkill(s, skillCatalog.controlledValues)).length
	);

	async function submit() {
		const name = fullName.trim();
		const spaceIndex = name.indexOf(' ');
		if (!name || spaceIndex < 1) {
			toast.error('กรุณากรอกชื่อและนามสกุล คั่นด้วยเว้นวรรค เช่น "สมชาย ใจดี"');
			return;
		}
		if (!phone.trim()) {
			toast.error('กรุณากรอกเบอร์โทรศัพท์');
			return;
		}

		try {
			await updateMutation.mutateAsync({
				...volunteer,
				first_name: name.slice(0, spaceIndex).trim(),
				last_name: name.slice(spaceIndex + 1).trim(),
				phone: phone.trim(),
				skills: selectedSkills,
				personnel_type: personnelType
			});
			toast.success('บันทึกข้อมูลอาสาสมัครแล้ว');
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
				<Settings2 class="h-4.5 w-4.5" />
			</div>
			<div class="min-w-0">
				<Dialog.Title class="text-base font-bold">
					จัดการข้อมูลอาสาสมัคร ({volunteer.volunteer_code})
				</Dialog.Title>
				<p class="text-xs text-muted-foreground">
					แก้ไขข้อมูลส่วนบุคคล, ชนิดบุคลากร, กะที่มอบหมาย และทักษะรับรอง
				</p>
			</div>
		</div>

		<div class="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
			<div class="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
				<p class="text-xs font-bold text-foreground">สถานะปัจจุบัน (IDENTITY &amp; DUTY STATUS)</p>
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge
						variant="outline"
						class="gap-1 {volunteer.identity_verified
							? 'border-emerald-300 bg-emerald-50 text-emerald-700'
							: 'border-amber-300 bg-amber-50 text-amber-700'}"
					>
						<span
							class="h-1.5 w-1.5 rounded-full {volunteer.identity_verified
								? 'bg-emerald-500'
								: 'bg-amber-500'}"
						></span>
						{volunteer.identity_verified ? 'ยืนยันตัวตนแล้ว' : 'รอยืนยันตัวตน'}
					</Badge>
					<Badge
						variant="outline"
						class="gap-1 {volunteer.checked_in
							? 'border-emerald-300 bg-emerald-50 text-emerald-700'
							: 'text-muted-foreground'}"
					>
						<span
							class="h-1.5 w-1.5 rounded-full {volunteer.checked_in
								? 'bg-emerald-500'
								: 'bg-muted-foreground/50'}"
						></span>
						{volunteer.checked_in ? 'ปฏิบัติหน้าที่อยู่' : 'ไม่ได้ปฏิบัติหน้าที่'}
					</Badge>
				</div>
				<p class="text-xs text-muted-foreground">สังกัดศูนย์: {shelterLine}</p>
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs font-bold text-foreground">ข้อมูลพื้นฐาน (BASIC INFORMATION)</p>
					<Badge variant="outline" class="text-[11px]">ID: {volunteer.volunteer_code}</Badge>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="vm-name">ชื่อ-นามสกุล <span class="text-destructive">*</span></Label>
						<Input id="vm-name" bind:value={fullName} class="h-11" />
					</div>
					<div class="space-y-1.5">
						<Label for="vm-phone">เบอร์โทรศัพท์ <span class="text-destructive">*</span></Label>
						<Input id="vm-phone" bind:value={phone} class="h-11" />
					</div>
				</div>
			</div>

			<div class="space-y-2">
				<p class="text-xs font-bold text-foreground">ชนิดบุคคล (PERSONNEL TYPE)</p>
				<div class="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center {personnelType === 'volunteer'
							? 'border-primary bg-primary/5 text-primary'
							: ''}"
						aria-pressed={personnelType === 'volunteer'}
						onclick={() => (personnelType = 'volunteer')}
					>
						🎫 อาสาสมัคร
					</Button>
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center {personnelType === 'staff'
							? 'border-primary bg-primary/5 text-primary'
							: ''}"
						aria-pressed={personnelType === 'staff'}
						onclick={() => (personnelType = 'staff')}
					>
						🏢 จนท.ประจำ
					</Button>
				</div>
			</div>

			<div class="space-y-2 rounded-xl border border-border p-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-xs font-bold text-foreground">สิทธิ์ระบบหลังบ้าน (STAFF SYSTEM ACCESS)</p>
					<button
						type="button"
						class="text-[11px] font-medium text-primary hover:underline"
						onclick={() => stub('จัดการสิทธิ์ย่อยที่ระบบ User Management')}
					>
						จัดการสิทธิ์ย่อยที่ระบบ User Management
					</button>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/30 p-3">
					<div class="min-w-0">
						<p class="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
							บัญชีผู้ใช้งานระบบหลังบ้าน
							<Badge variant="outline" class="text-[10px]">
								{volunteer.user_name ? `มีบัญชี: ${volunteer.user_name}` : 'ยังไม่มีบัญชีหลังบ้าน'}
							</Badge>
						</p>
						<p class="mt-0.5 text-[11px] text-muted-foreground">
							หากปฏิบัติตำแหน่งช่วยงานระบบเจ้าหน้าที่
							สามารถออกสิทธิ์หลังบ้านโดยผูกบัญชีกับเบอร์โทรศัพท์
						</p>
					</div>
					<Button
						size="sm"
						class="shrink-0 gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
						onclick={() => stub('ออกสิทธิ์เข้าใช้งานระบบหลังบ้าน')}
					>
						<KeyRound class="h-3.5 w-3.5" />
						ออกสิทธิ์เข้าใช้งานระบบหลังบ้าน
					</Button>
				</div>
			</div>

			<div class="space-y-2">
				<p class="text-xs font-bold text-foreground">กะที่มอบหมาย (ASSIGNED SHIFT)</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
					{#each SHIFT_TILES as tile (tile.value)}
						<button
							type="button"
							onclick={() => {
								assignedShift = tile.value;
								stub('เปลี่ยนกะที่มอบหมาย');
							}}
							aria-pressed={assignedShift === tile.value}
							class="flex items-center justify-center rounded-xl border p-3 text-center text-xs font-bold transition-colors {assignedShift ===
							tile.value
								? 'border-primary-dark bg-primary-dark text-white'
								: 'border-border text-foreground hover:bg-muted/40'}"
						>
							{tile.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs font-bold text-foreground">ทักษะอาสาสมัคร (MASTER SKILLS LIST)</p>
					<Badge variant="secondary" class="text-[11px]">
						ทักษะทั่วไปที่เลือก: {generalSelectedCount} ทักษะ
					</Badge>
				</div>

				<div class="space-y-1.5">
					<p class="text-[11px] font-medium text-muted-foreground">
						ทักษะทั่วไป (General Skills) — คลิก/ปลดคลิกเพื่อแก้ไขได้อิสระ
					</p>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each skillsList.filter((s) => !s.controlled) as skill (skill.code)}
							{@const checked = selectedSkills.includes(skill.code)}
							<label
								class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors {checked
									? 'border-primary bg-primary/5'
									: 'border-border hover:bg-muted/40'}"
							>
								<Checkbox {checked} onCheckedChange={() => toggleSkill(skill.code)} />
								<span class="min-w-0 text-xs">
									<span class="flex items-center gap-1.5 font-medium">
										<span aria-hidden="true">{skill.icon}</span>
										<span class="truncate">{skill.label}</span>
									</span>
									<span class="mt-0.5 block text-muted-foreground">{skill.description}</span>
								</span>
							</label>
						{/each}
					</div>
				</div>

				<div class="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
					<div class="flex items-center justify-between gap-2">
						<p class="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
							<Lock class="h-3 w-3" />
							ทักษะควบคุม (Controlled Skills • Read-Only)
						</p>
						<Badge variant="outline" class="border-amber-300 text-[10px] text-amber-700">
							ต้องรับรองผ่าน EOC
						</Badge>
					</div>
					{#each skillsList.filter((s) => s.controlled) as skill (skill.code)}
						{@const has = selectedSkills.includes(skill.code)}
						<div
							class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background p-2.5"
						>
							<span class="min-w-0 text-xs">
								<span class="flex flex-wrap items-center gap-1.5 font-medium">
									<ShieldAlert class="h-3.5 w-3.5 text-amber-600" />
									{skill.label}
									<Badge variant="outline" class="text-[10px]">ควบคุม</Badge>
								</span>
								<span class="mt-0.5 block text-muted-foreground">{skill.description}</span>
							</span>
							<Badge
								variant="outline"
								class="shrink-0 text-[10px] {has
									? 'border-emerald-300 text-emerald-700'
									: 'text-muted-foreground'}"
							>
								{has ? 'มีทักษะนี้แล้ว' : 'ยังไม่มีทักษะนี้'}
							</Badge>
						</div>
					{/each}
					<Button
						type="button"
						size="sm"
						variant="outline"
						class="w-full gap-1.5"
						onclick={() => stub('ตรวจสอบ/รับรองทักษะควบคุม')}
					>
						<ClipboardCheck class="h-3.5 w-3.5" />
						ตรวจสอบ/รับรองทักษะนี้ (Audit Checklist)
					</Button>
				</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
			<div class="flex gap-2">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button
					type="button"
					class="gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
					disabled={updateMutation.isPending}
					onclick={submit}
				>
					{#if updateMutation.isPending}
						กำลังบันทึก...
					{:else}
						<Check class="h-4 w-4" />
						บันทึกข้อมูลอาสาสมัคร
					{/if}
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
