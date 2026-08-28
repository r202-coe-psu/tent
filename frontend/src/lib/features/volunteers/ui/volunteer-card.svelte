<script lang="ts">
	/**
	 * "People" tab roster row (owner-approved mockup, 2026-08-28).
	 *
	 * All 4 action buttons (จัดการข้อมูล / ออกสิทธิ์ใช้งานระบบ / ขอโอนย้ายศูนย์ /
	 * ลบ) and the pending row's "ตรวจสอบ & อนุมัติ" button are UI-only stubs
	 * for this pass (explicit scope call from the requester) — none of them
	 * are wired to a mutation yet, they just toast that the flow isn't built:
	 *   - edit: no `Volunteer` edit form exists yet.
	 *   - grant/revoke system access: no RoleKey-grant repository call exists
	 *     yet (FR-VOL-05R is a CouchDB-native time-bound grant, not modelled
	 *     here).
	 *   - "ตรวจสอบ & อนุมัติ": no `verifyIdentity`-shaped repository method
	 *     exists — `VolunteerRepository` only has a generic `update()`, and an
	 *     identity-check flow deserves its own reviewed method, not a
	 *     freeform PUT from the UI.
	 *   - delete: `VolunteerRepository` has no `delete()` at all.
	 * All four are flagged for the CR alongside the schema gaps.
	 */
	import Pencil from '@lucide/svelte/icons/pencil';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import Phone from '@lucide/svelte/icons/phone';
	import Lock from '@lucide/svelte/icons/lock';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { findSkill } from '../domain/skill-master';
	import { isControlledSkill } from '../domain/skills';
	import type { Volunteer, VolunteerSource } from '../domain/volunteer.schema';
	import type { ShiftAssignment, ShiftKind } from '../domain/shift-assignment.schema';

	let {
		volunteer,
		shelterName,
		shelterType,
		todayAssignment
	}: {
		volunteer: Volunteer;
		shelterName: string | undefined;
		shelterType: string | null | undefined;
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
	const hasControlledSkill = $derived(volunteer.skills.some((s) => isControlledSkill(s)));
	const shelterLine = $derived(
		shelterName ? (shelterType ? `${shelterName} (${shelterType})` : shelterName) : '—'
	);

	function stub(label: string) {
		toast.info(`${label} — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา`);
	}
</script>

<div
	class="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.6fr)] lg:items-start lg:gap-3"
>
	<!-- ข้อมูลบุคคล (VOLUNTEER INFO) -->
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

	<!-- ทักษะ (SKILLS) -->
	<div class="flex flex-wrap content-start gap-1.5">
		{#each volunteer.skills as skill (skill)}
			{@const master = findSkill(skill)}
			<Badge
				variant="outline"
				class="max-w-full gap-1 text-[11px] break-words {isControlledSkill(skill)
					? 'border-amber-300 bg-amber-50 text-amber-800'
					: ''}"
			>
				{#if master}<span aria-hidden="true">{master.icon}</span>{/if}
				{master?.label ?? skill}
			</Badge>
		{:else}
			<span class="text-xs text-muted-foreground">—</span>
		{/each}
	</div>

	<!-- สังกัดศูนย์ (SHELTER) -->
	<div class="text-sm font-medium text-foreground">
		{shelterLine}
	</div>

	<!-- สถานะยืนยันตัวตน & กะงาน -->
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

	<!-- จัดการ (ACTIONS) -->
	<div class="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch">
		{#if !volunteer.identity_verified}
			<Button
				size="sm"
				class="gap-1.5 border-amber-400 bg-amber-500 text-white hover:bg-amber-600"
				onclick={() => stub('ตรวจสอบ & อนุมัติ')}
			>
				<Search class="h-3.5 w-3.5" />
				ตรวจสอบ & อนุมัติ
			</Button>
		{:else}
			<Button size="sm" variant="outline" class="gap-1.5" onclick={() => stub('จัดการข้อมูล')}>
				<Pencil class="h-3.5 w-3.5" />
				จัดการข้อมูล
			</Button>
		{/if}

		<div class="flex items-center gap-1.5">
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="sm"
								class="flex-1 gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
								onclick={() => stub('ออกสิทธิ์ใช้งานระบบ')}
							>
								<KeyRound class="h-3.5 w-3.5" />
								ออกสิทธิ์ใช้งานระบบ
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>ให้/เพิกถอนสิทธิ์เข้าสู่ระบบ (Time-bound Write Access)</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>

			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="icon"
								variant="outline"
								class="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
								onclick={() => stub('ขอโอนย้ายศูนย์')}
							>
								<ArrowLeftRight class="h-4 w-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>ขอโอนย้ายศูนย์</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>

			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="icon"
								variant="outline"
								class="shrink-0 border-rose-200 text-rose-600 hover:bg-rose-50"
								onclick={() => stub('ลบอาสาสมัคร')}
							>
								<Trash2 class="h-4 w-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>ลบอาสาสมัคร</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>
	</div>
</div>
