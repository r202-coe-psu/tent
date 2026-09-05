<script lang="ts">
	/**
	 * "People" tab roster row (owner-approved mockup, 2026-08-28; switched from a
	 * div-grid card to a real `<Table.Row>` 2026-08-30 so rows sit flush against
	 * each other with a shared header — mirrors `users/ui/user-list.svelte`).
	 * Rendered inside `people-tab.svelte`'s `<Table.Body>`.
	 *
	 * Of the 3 action buttons (จัดการข้อมูล/ ออกสิทธิ์ใช้งานระบบ / ลบ):
	 *   - Already verified → "จัดการข้อมูล" opens `volunteer-manage-dialog.svelte`
	 *     (see its header comment for the fields it actually persists vs. stubs).
	 *   - "ออกสิทธิ์ใช้งานระบบ" opens `volunteer-access-dialog.svelte`, which
	 *     creates a CouchDB login through the authorized users API and links
	 *     its username/email back to the volunteer profile.
	 * (Cross-shelter transfer was cut by CR-104 AC-104-10 — a volunteer now
	 * applies directly to any shelter's jobs via the Job Board instead.)
	 * "ลบ" stays a UI-only stub for this pass (explicit scope call from the
	 * requester) — `VolunteerRepository` has no `delete()` at all, flagged for
	 * the CR alongside the other schema gaps.
	 */
	import Pencil from '@lucide/svelte/icons/pencil';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Phone from '@lucide/svelte/icons/phone';
	import Lock from '@lucide/svelte/icons/lock';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import VolunteerManageDialog from './volunteer-manage-dialog.svelte';
	import VolunteerAccessDialog from './volunteer-access-dialog.svelte';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import type { Volunteer, VolunteerSource } from '../domain/volunteer.schema';
	import type { ShiftAssignment, ShiftKind } from '../domain/shift-assignment.schema';

	let {
		volunteer,
		shelterName,
		shelterType,
		skillOptions = [],
		todayAssignment
	}: {
		volunteer: Volunteer;
		shelterName: string | undefined;
		shelterType: string | null | undefined;
		skillOptions?: readonly SkillOption[];
		todayAssignment: Pick<ShiftAssignment, 'shift' | 'station' | 'status'> | null | undefined;
	} = $props();

	const SOURCE_LABELS: Record<VolunteerSource, string> = {
		public_apply: 'สมัครออนไลน์',
		walk_in: 'Walk-in',
		staff_entry: 'เจ้าหน้าที่บันทึก',
		transfer: 'โอนย้ายจากศูนย์อื่น'
	};

	const SHIFT_LABELS: Record<ShiftKind, string> = {
		morning: 'กะเช้า (08:00–16:00)',
		afternoon: 'กะบ่าย (16:00–00:00)',
		night: 'กะดึก (00:00–08:00)',
		flex: 'ยืดหยุ่น (Flex)',
		custom: 'กะกำหนดเอง'
	};

	const initial = $derived(volunteer.first_name.trim().charAt(0) || '?');
	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());
	const skills = $derived(
		volunteer.skills.flatMap((value) => {
			const option = resolveSkillOption(value, skillOptions);
			return option ? [option] : [];
		})
	);
	const hasControlledSkill = $derived(skills.some((skill) => skill.controlled));
	const shelterLine = $derived(
		shelterName ? (shelterType ? `${shelterName} (${shelterType})` : shelterName) : '—'
	);

	function stub(label: string) {
		toast.info(`${label} — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา`);
	}

	let manageDialogOpen = $state(false);
	let accessDialogOpen = $state(false);
</script>

<Table.Row>
	<!-- ข้อมูลบุคคล (VOLUNTEER INFO) -->
	<Table.Cell class="w-[27%] p-4 align-top whitespace-normal">
		<div class="flex items-start gap-3">
			<div
				class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
			>
				{initial}
			</div>
			<div class="min-w-0 space-y-1.5">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-sm font-bold text-foreground">{fullName}</span>
					<Badge variant="outline" class="text-[11px]">{volunteer.volunteer_code}</Badge>
				</div>
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary" class="text-[11px]">{SOURCE_LABELS[volunteer.source]}</Badge>
					{#if hasControlledSkill}
						<Badge
							variant="outline"
							class="border-violet-300 bg-violet-50 text-[11px] text-violet-700"
						>
							ทักษะวิชาชีพ/ควบคุม
						</Badge>
					{/if}
					{#if !volunteer.checked_in}
						<Badge variant="outline" class="gap-1 text-[11px] text-muted-foreground">
							<span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"></span>
							Off-site
						</Badge>
					{/if}
				</div>
				{#if volunteer.checked_in}
					<p
						class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
					>
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
						On-site ปฏิบัติหน้าที่ ณ {shelterLine}
					</p>
				{/if}
				{#if volunteer.phone}
					<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Phone class="h-3.5 w-3.5" />
						{volunteer.phone}
					</p>
				{/if}
			</div>
		</div>
	</Table.Cell>

	<!-- ทักษะ (SKILLS) -->
	<Table.Cell class="w-[16%] p-4 align-top whitespace-normal">
		<div class="flex flex-wrap content-start gap-1.5">
			{#each skills as skill (skill.code)}
				<Badge
					variant="outline"
					class="max-w-full gap-1 text-[11px] break-words {skill.controlled
						? 'border-amber-300 bg-amber-50 text-amber-800'
						: ''}"
				>
					<span aria-hidden="true">{skill.icon}</span>
					{skill.label}
				</Badge>
			{:else}
				<span class="text-xs text-muted-foreground">—</span>
			{/each}
		</div>
	</Table.Cell>

	<!-- สังกัดศูนย์ (SHELTER) -->
	<Table.Cell class="w-[17%] p-4 align-top text-sm font-medium whitespace-normal text-foreground">
		{shelterLine}
	</Table.Cell>

	<!-- สถานะยืนยันตัวตน & กะงาน -->
	<Table.Cell class="w-[19%] p-4 align-top whitespace-normal">
		<div class="space-y-1.5">
			{#if volunteer.identity_verified}
				<Badge class="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					ยืนยันตัวตนแล้ว
				</Badge>
			{:else}
				<Badge class="gap-1 border-amber-300 bg-amber-50 text-amber-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
					รอยืนยันตัวตน
				</Badge>
			{/if}

			{#if volunteer.checked_in}
				<Badge class="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					ปฏิบัติหน้าที่อยู่
				</Badge>
			{:else if volunteer.identity_verified}
				<Badge class="gap-1 border-sky-300 bg-sky-50 text-sky-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
					รอสแตนด์บาย
				</Badge>
			{:else}
				<Badge variant="outline" class="gap-1 text-muted-foreground">
					<Lock class="h-3 w-3" />
					รอสแตนด์บาย
				</Badge>
			{/if}

			{#if todayAssignment}
				<p class="text-xs text-muted-foreground">{SHIFT_LABELS[todayAssignment.shift]}</p>
			{:else if !volunteer.identity_verified}
				<p class="text-[11px] text-amber-700">ต้องให้ จนท. ตรวจบัตร ปชช. ก่อนเข้ากะ</p>
			{/if}
		</div>
	</Table.Cell>

	<!-- จัดการ (ACTIONS) -->
	<Table.Cell class="w-[21%] p-4 align-top whitespace-normal">
		<div class="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch">
			<Button size="sm" variant="outline" class="gap-1.5" onclick={() => (manageDialogOpen = true)}>
				<Pencil class="h-3.5 w-3.5" />
				จัดการข้อมูล
			</Button>

			<div class="flex items-center gap-1.5">
				<Button
					size="sm"
					class="flex-1 gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
					onclick={() => (accessDialogOpen = true)}
				>
					<KeyRound class="h-3.5 w-3.5" />
					ออกสิทธิ์ใช้งานระบบ
				</Button>

				<Button
					size="icon"
					variant="outline"
					class="shrink-0 border-rose-200 text-rose-600 hover:bg-rose-50"
					aria-label="ลบอาสาสมัคร"
					onclick={() => stub('ลบอาสาสมัคร')}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		</div>
	</Table.Cell>
</Table.Row>

<VolunteerManageDialog
	bind:open={manageDialogOpen}
	{volunteer}
	{shelterLine}
	todayShift={todayAssignment?.shift}
/>
<VolunteerAccessDialog bind:open={accessDialogOpen} {volunteer} {shelterLine} />
