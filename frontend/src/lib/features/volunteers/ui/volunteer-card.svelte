<script lang="ts">
	/**
	 * "People" tab roster row (owner-approved mockup, 2026-08-28; switched from a
	 * div-grid card to a real `<Table.Row>` 2026-08-30 so rows sit flush against
	 * each other with a shared header — mirrors `users/ui/user-list.svelte`).
	 * Rendered inside `people-tab.svelte`'s `<Table.Body>`.
	 *
	 * Of the action buttons (ตรวจสอบ & อนุมัติ / จัดการข้อมูล / ออกสิทธิ์ใช้งานระบบ / ปิดใช้งาน):
	 *   - Not identity-verified → only "ตรวจสอบ & อนุมัติ" opens the
	 *     volunteer-level qualification audit. It records identity and
	 *     controlled-skill evidence; it does not approve a specific job.
	 *   - Already verified → "จัดการข้อมูล" opens `volunteer-manage-dialog.svelte`
	 *     (see its header comment for the fields it actually persists vs. stubs).
	 *   - "ออกสิทธิ์ใช้งานระบบ" opens `volunteer-access-dialog.svelte`, which
	 *     creates a CouchDB login through the authorized users API and links
	 *     its username/email back to the volunteer profile.
	 * (Cross-shelter transfer was cut by CR-104 AC-104-10 — a volunteer now
	 * applies directly to any shelter's jobs via the Job Board instead.)
	 */
	import Pencil from '@lucide/svelte/icons/pencil';
	import SearchCheck from '@lucide/svelte/icons/search-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Phone from '@lucide/svelte/icons/phone';
	import Lock from '@lucide/svelte/icons/lock';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import VolunteerManageDialog from './volunteer-manage-dialog.svelte';
	import VolunteerQualificationDialog from './volunteer-qualification-dialog.svelte';
	import VolunteerAccessDialog from './volunteer-access-dialog.svelte';
	import { useDeactivateVolunteer } from '../application/queries';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import {
		hasPendingControlledSkill,
		identityVerificationStatus,
		skillVerificationStatus
	} from '../domain/verification';
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
	const skills = $derived.by<SkillOption[]>(() => {
		// This map is a local deduplication buffer and is not exposed to the template.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, SkillOption>();
		for (const value of volunteer.skills) {
			const option = resolveSkillOption(value, skillOptions);
			if (option && !map.has(option.code)) {
				map.set(option.code, option);
			}
		}
		return Array.from(map.values());
	});
	const shelterLine = $derived(
		shelterName ? (shelterType ? `${shelterName} (${shelterType})` : shelterName) : '—'
	);
	const identityStatus = $derived(identityVerificationStatus(volunteer));
	const needsSkillReview = $derived(
		hasPendingControlledSkill(
			volunteer,
			volunteer.skills,
			skillOptions
				.filter((option) => option.controlled)
				.flatMap((option) => [option.code, option.label])
		)
	);
	const pendingSkillCode = $derived(
		skills.find(
			(skill) => skill.controlled && skillVerificationStatus(volunteer, skill.code) !== 'verified'
		)?.code ?? null
	);

	let manageDialogOpen = $state(false);
	let qualificationDialogOpen = $state(false);
	let qualificationFocusSkillCode = $state<string | null>(null);
	let accessDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);

	const queryClient = useQueryClient();
	const deactivateMutation = useDeactivateVolunteer(queryClient);

	function openQualificationAudit(skillCode?: string) {
		manageDialogOpen = false;
		qualificationFocusSkillCode = skillCode ?? null;
		qualificationDialogOpen = true;
	}

	function confirmDeactivate(event: MouseEvent) {
		event.preventDefault();
		deactivateMutation.mutate(volunteer._id, {
			onSuccess: () => {
				deleteDialogOpen = false;
				toast.success(`ปิดใช้งานอาสาสมัคร ${fullName} แล้ว`);
			},
			onError: (error) => {
				toast.error(error instanceof Error ? error.message : 'ปิดใช้งานอาสาสมัครไม่สำเร็จ');
			}
		});
	}
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
					<Badge
						variant="outline"
						class="text-[11px] {volunteer.personnel_type === 'staff'
							? 'border-indigo-200 bg-indigo-50 font-bold text-indigo-700'
							: 'text-muted-foreground'}"
					>
						{volunteer.personnel_type === 'staff' ? '🏢 จนท.ประจำ' : '🎫 อาสาสมัคร'}
					</Badge>
					<Badge variant="outline" class="text-[11px] text-muted-foreground">
						{SOURCE_LABELS[volunteer.source]}
					</Badge>
					{#if volunteer.status === 'inactive'}
						<Badge
							variant="outline"
							class="border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700"
						>
							ปิดใช้งาน
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
						class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
					>
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
						On-site
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
			{#each skills as skill, idx (`${skill.code}-${idx}`)}
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
	<Table.Cell class="w-[22%] p-4 align-top whitespace-normal">
		<div class="space-y-1.5">
			{#if identityStatus === 'verified'}
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

			{#if needsSkillReview}
				<Badge class="gap-1 border-amber-300 bg-amber-50 text-amber-800" variant="outline">
					<Lock class="h-3 w-3" />
					รอรับรองทักษะควบคุม
				</Badge>
			{/if}

			{#if volunteer.checked_in}
				<Badge class="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					ปฏิบัติหน้าที่อยู่
				</Badge>
			{:else if identityStatus === 'verified'}
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
			{:else if identityStatus !== 'verified'}
				<p class="text-[11px] text-amber-700">ต้องให้ จนท. ตรวจบัตร ปชช. ก่อนเข้ากะ</p>
			{/if}
		</div>
	</Table.Cell>

	<!-- จัดการ (ACTIONS) -->
	<Table.Cell class="w-[18%] p-4 align-top whitespace-normal">
		<div class="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch">
			{#if identityStatus !== 'verified' || needsSkillReview}
				<Button
					size="sm"
					class="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
					onclick={() =>
						openQualificationAudit(
							identityStatus === 'verified' ? (pendingSkillCode ?? undefined) : undefined
						)}
				>
					<SearchCheck class="h-3.5 w-3.5" />
					ตรวจสอบ &amp; อนุมัติ
				</Button>
			{:else}
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5"
					onclick={() => (manageDialogOpen = true)}
				>
					<Pencil class="h-3.5 w-3.5" />
					จัดการข้อมูล
				</Button>
			{/if}

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
					aria-label="ปิดใช้งานอาสาสมัคร"
					onclick={() => (deleteDialogOpen = true)}
					disabled={deactivateMutation.isPending || volunteer.status === 'inactive'}
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
	onOpenQualificationAudit={openQualificationAudit}
/>
<VolunteerQualificationDialog
	bind:open={qualificationDialogOpen}
	{volunteer}
	{shelterLine}
	focusSkillCode={qualificationFocusSkillCode}
/>
<VolunteerAccessDialog bind:open={accessDialogOpen} {volunteer} {shelterLine} />

<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการปิดใช้งานอาสาสมัคร?</AlertDialog.Title>
			<AlertDialog.Description>
				โปรไฟล์ <span class="font-semibold text-foreground">{fullName}</span>
				(<code class="text-xs">{volunteer.volunteer_code}</code>) จะเปลี่ยนสถานะเป็น
				<code class="text-xs">inactive</code> และเก็บประวัติไว้ในระบบ อาสาสมัครจะไม่สามารถรับงานใหม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deactivateMutation.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={confirmDeactivate}
				disabled={deactivateMutation.isPending}
			>
				{deactivateMutation.isPending ? 'กำลังปิดใช้งาน...' : 'ยืนยันการปิดใช้งาน'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
