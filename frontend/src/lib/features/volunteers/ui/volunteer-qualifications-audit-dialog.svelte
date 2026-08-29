<script lang="ts">
	/**
	 * "ตรวจสอบคุณสมบัติ & อนุมัติการเข้างาน (Volunteer Qualifications Audit)" —
	 * opened from `volunteer-card.svelte`'s "ตรวจสอบ & อนุมัติ" button, ONLY for
	 * a not-yet-`identity_verified` volunteer (the already-verified case keeps
	 * using `volunteer-manage-dialog.svelte`'s generic "จัดการข้อมูล" editor).
	 *
	 * Real writes, via the existing `useUpdateVolunteer` (LWW read-modify-write,
	 * same as every other edit in this feature):
	 *   - "อนุมัติผ่านเกณฑ์ทักษะวิชาชีพ/ควบคุม" → `identity_verified: true`, skills
	 *     kept as submitted (including the controlled ones — they're certified).
	 *   - "อนุมัติระดับอาสาทั่วไป (Operational Only)" → `identity_verified: true`,
	 *     but any controlled skill (`domain/skills.ts#isControlledSkill`) is
	 *     stripped from `volunteer.skills` — they were not certified for it, so
	 *     the profile must not go on claiming it.
	 *   - "ปฏิเสธคำขอ" → `status: 'inactive'` (schema.md §2.8's own "is this a
	 *     valid roster profile" flag — `identity_verified` stays false). There is
	 *     no UI path yet to reverse this back to `active`; flagged for the CR
	 *     alongside this feature's other schema gaps.
	 * The controlled-skill-certification distinction and the reject decision
	 * both reuse existing fields — no schema change.
	 *
	 * NOT persisted (no backing field — flagged for the CR, same convention as
	 * `volunteer-manage-dialog.svelte`'s stubs):
	 *   - "ผู้ตรวจ (Officer)" — informational only, shows the logged-in staff
	 *     user (`authStore.user?.name`); `volunteer` has no `identity_verified_by`.
	 *   - "หมายเหตุการพิจารณาเพิ่มเติม" — free-text, no field to hold it.
	 *
	 * The "1/1" pager browses the shelter's live queue of pending-identity
	 * volunteers (`status === 'active' && !identity_verified` — the exact
	 * `domain/hub-metrics.ts#computeHubMetrics` `pendingIdentity` predicate) so
	 * staff can work through several applications without closing/reopening the
	 * dialog each time; approving/rejecting still closes it rather than
	 * auto-advancing, to avoid acting on a stale index while the list refetches.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Ban from '@lucide/svelte/icons/ban';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useUpdateVolunteer, useVolunteers } from '../application/queries';
	import { findSkill } from '../domain/skill-master';
	import { isControlledSkill } from '../domain/skills';
	import type { Volunteer } from '../domain/volunteer.schema';

	let {
		open = $bindable(false),
		volunteer,
		shelterLine
	}: {
		open?: boolean;
		volunteer: Volunteer;
		shelterLine: string;
	} = $props();

	const queryClient = useQueryClient();
	const updateMutation = useUpdateVolunteer(queryClient);
	const volunteersQuery = useVolunteers();

	// Same predicate as `computeHubMetrics`'s `pendingIdentity` counter — kept in
	// sync deliberately so this dialog's queue length matches what the header
	// tile and this row's own "รอยืนยันตัวตน" badge already claim.
	const pendingQueue = $derived(
		(volunteersQuery.data ?? []).filter((v) => v.status === 'active' && !v.identity_verified)
	);

	let activeIndex = $state(0);
	let lastOpenedId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		const idx = pendingQueue.findIndex((v) => v._id === volunteer._id);
		activeIndex = idx >= 0 ? idx : 0;
		lastOpenedId = volunteer._id;
	});

	// Fall back to the prop when the queue hasn't loaded yet (or this volunteer
	// fell out of it mid-review, e.g. someone else just processed them).
	const current = $derived(pendingQueue[activeIndex] ?? volunteer);
	const fullName = $derived(`${current.first_name} ${current.last_name}`.trim());
	const requestedControlledSkills = $derived(current.skills.filter((s) => isControlledSkill(s)));

	function formatNationalId(id: string | null | undefined): string {
		const d = (id ?? '').replace(/\D/g, '');
		if (d.length !== 13) return id || '—';
		return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
	}

	type Decision = 'controlled' | 'operational' | 'reject';
	let decision = $state<Decision>('operational');
	let notes = $state('');

	// Reset the form each time a different applicant becomes `current` — via
	// navigation, not just on open (mirrors `volunteer-manage-dialog.svelte`'s
	// `lastOpenedId` rehydrate, one level down).
	let lastFormId = $state<string | null>(null);
	$effect(() => {
		if (current._id === lastFormId) return;
		decision = 'operational';
		notes = '';
		lastFormId = current._id;
	});

	function prev() {
		if (activeIndex > 0) activeIndex -= 1;
	}
	function next() {
		if (activeIndex < pendingQueue.length - 1) activeIndex += 1;
	}

	async function save(finalDecision: Decision) {
		try {
			if (finalDecision === 'reject') {
				await updateMutation.mutateAsync({ ...current, status: 'inactive' });
				toast.success(`ปฏิเสธคำขอของ ${fullName} แล้ว`);
			} else {
				const skills =
					finalDecision === 'operational'
						? current.skills.filter((s) => !isControlledSkill(s))
						: current.skills;
				await updateMutation.mutateAsync({ ...current, identity_verified: true, skills });
				toast.success(
					`อนุมัติ ${fullName} แล้ว (${finalDecision === 'controlled' ? 'ผ่านเกณฑ์ทักษะควบคุม' : 'ระดับอาสาทั่วไป'})`
				);
			}
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกผลไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
				<Search class="h-4.5 w-4.5" />
			</div>
			<Dialog.Title class="text-base font-bold">
				ตรวจสอบคุณสมบัติ &amp; อนุมัติการเข้างาน (Volunteer Qualifications Audit)
			</Dialog.Title>
		</div>

		<div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
			>
				<div class="flex min-w-0 items-center gap-2">
					<UserCog class="h-4 w-4 shrink-0 text-muted-foreground" />
					<span class="shrink-0 text-xs text-muted-foreground">ผู้ตรวจ (Officer):</span>
					<span class="truncate text-sm font-bold text-foreground">
						{authStore.user?.name ?? '—'}
					</span>
				</div>
				{#if pendingQueue.length > 1}
					<div class="flex shrink-0 items-center gap-1">
						<Button size="icon" variant="ghost" disabled={activeIndex <= 0} onclick={prev}>
							<ChevronLeft class="h-4 w-4" />
						</Button>
						<span class="text-xs text-muted-foreground tabular-nums">
							{activeIndex + 1}/{pendingQueue.length}
						</span>
						<Button
							size="icon"
							variant="ghost"
							disabled={activeIndex >= pendingQueue.length - 1}
							onclick={next}
						>
							<ChevronRight class="h-4 w-4" />
						</Button>
					</div>
				{/if}
			</div>

			<div class="space-y-2">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<span class="h-2 w-2 rounded-full bg-primary-dark"></span>
					1. ข้อมูลผู้สมัคร (APPLICANT DETAILS)
				</p>
				<div class="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
					<div>
						<p class="text-[11px] text-muted-foreground">ชื่อ-นามสกุล (NAME)</p>
						<p class="flex flex-wrap items-center gap-1.5 text-sm font-bold text-foreground">
							{fullName}
							<Badge variant="outline" class="text-[10px]">{current.volunteer_code}</Badge>
						</p>
					</div>
					<div>
						<p class="text-[11px] text-muted-foreground">เบอร์โทรศัพท์ (CONTACT)</p>
						<p class="text-sm font-bold text-foreground">{current.phone ?? '—'}</p>
					</div>
					<div>
						<p class="text-[11px] text-muted-foreground">เลขบัตรประชาชน (NATIONAL ID)</p>
						<p class="text-sm font-bold text-foreground">{formatNationalId(current.national_id)}</p>
					</div>
					<div>
						<p class="text-[11px] text-muted-foreground">สังกัดศูนย์พักพิง (ASSIGNED SHELTER)</p>
						<p class="text-sm font-bold text-foreground">{shelterLine}</p>
					</div>
				</div>
			</div>

			<div class="space-y-2">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<span class="h-2 w-2 rounded-full bg-violet-500"></span>
					2. ทักษะวิชาชีพ/ควบคุมที่ยื่นขอ (CONTROLLED SKILLS &amp; LICENSES)
				</p>
				{#if requestedControlledSkills.length === 0}
					<div
						class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-emerald-800"
					>
						<CircleCheck class="h-4 w-4 shrink-0" />
						<p class="text-xs font-medium">
							ไม่มีทักษะควบคุมวิชาชีพที่ยื่นขอ (เป็นจิตอาสาปฏิบัติการทั่วไป)
						</p>
					</div>
				{:else}
					<div class="space-y-1.5">
						{#each requestedControlledSkills as skill (skill)}
							{@const master = findSkill(skill)}
							<div
								class="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-amber-900"
							>
								<ShieldCheck class="h-4 w-4 shrink-0" />
								<p class="text-xs font-medium">
									{master?.icon ?? ''}
									{master?.label ?? skill}
								</p>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="space-y-2">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
					3. ผลการพิจารณาอนุมัติ (REVIEW DECISION OPTIONS)
				</p>

				<div class="space-y-2">
					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'controlled'
							? 'border-emerald-400 bg-emerald-50/60'
							: 'border-border hover:bg-muted/40'} {requestedControlledSkills.length === 0
							? 'cursor-not-allowed opacity-50'
							: ''}"
					>
						<input
							type="radio"
							name="qualifications-decision"
							class="mt-1 accent-emerald-600"
							checked={decision === 'controlled'}
							disabled={requestedControlledSkills.length === 0}
							onchange={() => (decision = 'controlled')}
						/>
						<span class="min-w-0 text-xs">
							<span class="flex flex-wrap items-center gap-1.5 font-bold text-foreground">
								<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
								อนุมัติผ่านเกณฑ์ทักษะวิชาชีพ/ควบคุม
								{#if requestedControlledSkills.length > 0}
									<Badge variant="outline" class="border-emerald-300 text-[10px] text-emerald-700">
										รับรองทักษะวิชาชีพแล้ว
									</Badge>
								{/if}
							</span>
							<span class="mt-0.5 block text-muted-foreground">
								{requestedControlledSkills.length === 0
									? 'ไม่มีทักษะควบคุมที่ยื่นขอในคำร้องนี้'
									: 'ผ่านการรับรองทักษะควบคุมเรียบร้อย สามารถรับมอบหมายภารกิจเฉพาะทางตามทักษะที่ได้รับอนุมัติได้'}
							</span>
						</span>
					</label>

					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'operational'
							? 'border-sky-400 bg-sky-50/60'
							: 'border-border hover:bg-muted/40'}"
					>
						<input
							type="radio"
							name="qualifications-decision"
							class="mt-1 accent-sky-600"
							checked={decision === 'operational'}
							onchange={() => (decision = 'operational')}
						/>
						<span class="min-w-0 text-xs">
							<span class="flex items-center gap-1.5 font-bold text-foreground">
								<UserCheck class="h-3.5 w-3.5 text-sky-600" />
								อนุมัติระดับอาสาทั่วไป (Operational Only)
							</span>
							<span class="mt-0.5 block text-muted-foreground">
								ไม่ผ่านการรับรองทักษะควบคุม แต่สามารถช่วยเหลือปฏิบัติงานทั่วไปได้
							</span>
						</span>
					</label>

					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'reject'
							? 'border-rose-400 bg-rose-50/60'
							: 'border-border hover:bg-muted/40'}"
					>
						<input
							type="radio"
							name="qualifications-decision"
							class="mt-1 accent-rose-600"
							checked={decision === 'reject'}
							onchange={() => (decision = 'reject')}
						/>
						<span class="min-w-0 text-xs">
							<span class="flex items-center gap-1.5 font-bold text-rose-700">
								<Ban class="h-3.5 w-3.5" />
								ปฏิเสธคำขอ (ไม่ผ่านเกณฑ์)
							</span>
							<span class="mt-0.5 block text-rose-600">
								ไม่ผ่านเกณฑ์การตรวจสอบคุณสมบัติหรือไม่สะดวกให้เข้าปฏิบัติงาน
							</span>
						</span>
					</label>
				</div>

				<div class="space-y-1">
					<Textarea
						bind:value={notes}
						rows={2}
						placeholder="ระบุหมายเหตุการพิจารณาเพิ่มเติม (ถ้ามี)..."
					/>
					<p class="text-[11px] text-muted-foreground">
						หมายเหตุนี้เป็นข้อมูลระหว่างพิจารณาเท่านั้น ระบบยังไม่มีช่องบันทึกลงในระบบขณะนี้
					</p>
				</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-4">
			<Button
				type="button"
				variant="outline"
				class="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
				disabled={updateMutation.isPending}
				onclick={() => save('reject')}
			>
				<XCircle class="h-4 w-4" />
				ปฏิเสธคำขอ
			</Button>
			<Button
				type="button"
				class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				disabled={updateMutation.isPending}
				onclick={() => save(decision)}
			>
				<CircleCheck class="h-4 w-4" />
				บันทึกผลและอนุมัติ
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
