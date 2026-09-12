<script lang="ts">
	/**
	 * Volunteer-level qualification audit.
	 *
	 * This is intentionally separate from Job Details' application decision:
	 * the audit records reusable identity/controlled-skill evidence, while the
	 * job owner still decides whether this person fits a particular job.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { SvelteMap } from 'svelte/reactivity';
	import Search from '@lucide/svelte/icons/search';
	import UserRound from '@lucide/svelte/icons/user-round';
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import X from '@lucide/svelte/icons/x';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useReviewVolunteerIdentity,
		useReviewVolunteerSkill,
		useSkillOptions
	} from '../application/queries';
	import { isControlledSkill } from '../domain/skills';
	import { resolveSkillOption } from '../domain/skill-catalog';
	import {
		identityVerificationStatus,
		skillVerificationRecord,
		skillVerificationStatus,
		VERIFICATION_STATUS_LABEL,
		type VerificationStatus
	} from '../domain/verification';
	import type { Volunteer } from '../domain/volunteer.schema';

	type Decision = 'controlled' | 'operational' | 'rejected';
	type ControlledSkillRow = {
		code: string;
		label: string;
		description: string;
		status: VerificationStatus;
	};

	let {
		open = $bindable(false),
		volunteer,
		shelterLine,
		focusSkillCode = null
	}: {
		open?: boolean;
		volunteer: Volunteer;
		shelterLine: string;
		focusSkillCode?: string | null;
	} = $props();

	const queryClient = useQueryClient();
	const identityReviewMutation = useReviewVolunteerIdentity(queryClient);
	const skillReviewMutation = useReviewVolunteerSkill(queryClient);
	const skillCatalog = useSkillOptions();
	const skillOptions = $derived(skillCatalog.options);
	const actorName = $derived(authStore.user?.name ?? 'ผู้ดูแลระบบ');
	const identityStatus = $derived(identityVerificationStatus(volunteer));
	const nationalId = $derived(volunteer.national_id ?? 'ไม่ได้ระบุ');
	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());

	const allControlledSkills = $derived.by<ControlledSkillRow[]>(() => {
		const rows = new SvelteMap<string, ControlledSkillRow>();
		for (const value of volunteer.skills) {
			const option = resolveSkillOption(value, skillOptions);
			const controlled =
				option?.controlled || isControlledSkill(value, skillCatalog.controlledValues);
			if (!controlled) continue;
			const code = option?.code ?? value;
			if (rows.has(code)) continue;
			rows.set(code, {
				code,
				label: option?.label ?? value,
				description: option?.description ?? 'ทักษะควบคุมที่ต้องตรวจสอบก่อนรับรอง',
				status: skillVerificationStatus(volunteer, code)
			});
		}
		return Array.from(rows.values());
	});
	const controlledSkills = $derived(
		focusSkillCode && allControlledSkills.some((skill) => skill.code === focusSkillCode)
			? allControlledSkills.filter((skill) => skill.code === focusSkillCode)
			: allControlledSkills
	);

	let decision = $state<Decision>('controlled');
	let notes = $state('');
	let credentialReferences = $state<Record<string, string>>({});
	let lastOpenedId = $state<string | null>(null);

	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		decision = 'controlled';
		notes = '';
		credentialReferences = {};
		lastOpenedId = volunteer._id;
	});

	const isPending = $derived(identityReviewMutation.isPending || skillReviewMutation.isPending);
	const needsReason = $derived(decision === 'rejected' && notes.trim().length === 0);
	const decisionLabel = $derived(
		decision === 'controlled'
			? controlledSkills.length > 0
				? 'รับรองคุณสมบัติและทักษะควบคุม'
				: 'ยืนยันตัวตนและอนุมัติ'
			: decision === 'operational'
				? 'อนุมัติระดับอาสาทั่วไป'
				: 'ไม่ผ่านการตรวจ'
	);

	function statusClass(status: VerificationStatus) {
		return status === 'verified'
			? 'border-emerald-200 bg-emerald-50 text-emerald-700'
			: status === 'rejected'
				? 'border-rose-200 bg-rose-50 text-rose-700'
				: 'border-amber-200 bg-amber-50 text-amber-700';
	}

	function credentialReferenceValue(skillCode: string): string {
		return (
			credentialReferences[skillCode] ??
			skillVerificationRecord(volunteer, skillCode)?.credential_reference ??
			''
		);
	}

	async function submit() {
		if (isPending || needsReason) return;
		const reviewNotes = notes.trim() || null;
		const skillStatus: VerificationStatus = decision === 'controlled' ? 'verified' : 'rejected';

		try {
			// These writes must be sequential. Each repository call reads the latest
			// CouchDB revision, so parallel writes could race on the same volunteer.
			await identityReviewMutation.mutateAsync({
				id: volunteer._id,
				status: decision === 'rejected' ? 'rejected' : 'verified',
				notes: reviewNotes
			});
			for (const skill of controlledSkills) {
				await skillReviewMutation.mutateAsync({
					id: volunteer._id,
					skillCode: skill.code,
					status: skillStatus,
					notes: reviewNotes,
					credentialReference: credentialReferenceValue(skill.code).trim() || null
				});
			}
			toast.success(`${decisionLabel}แล้ว`);
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกผลตรวจไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[94vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
				<Search class="h-5 w-5" />
			</div>
			<div class="min-w-0">
				<Dialog.Title class="text-base font-bold">
					ตรวจสอบคุณสมบัติ &amp; อนุมัติการเข้าฐาน (Volunteer Qualifications Audit)
				</Dialog.Title>
				<p class="text-xs text-muted-foreground">
					บันทึกผลตรวจอาสาสมัครแยกจากการอนุมัติเข้างานแต่ละรายการ
				</p>
			</div>
		</div>

		<div class="max-h-[78vh] space-y-4 overflow-y-auto px-6 py-5">
			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3"
			>
				<div class="flex min-w-0 items-center gap-2">
					<UserRound class="h-4 w-4 shrink-0 text-primary" />
					<span class="text-sm font-semibold">ผู้ตรวจ (Officer):</span>
					<span class="truncate rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
						{actorName}
					</span>
				</div>
				<Badge variant="outline" class="text-xs">ศูนย์: {shelterLine}</Badge>
			</div>

			<section class="space-y-3 rounded-xl border border-border p-4">
				<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<span class="h-2.5 w-2.5 rounded-full bg-primary"></span>
					1. ข้อมูลผู้สมัคร (APPLICANT DETAILS)
				</h3>
				<div class="grid gap-3 rounded-xl bg-muted/30 p-4 sm:grid-cols-2">
					<div>
						<p class="text-2xs font-semibold text-muted-foreground">ชื่อ-นามสกุล (NAME)</p>
						<p class="font-semibold text-foreground">
							{fullName}
							<Badge variant="secondary" class="ml-1 text-2xs">{volunteer.volunteer_code}</Badge>
						</p>
					</div>
					<div>
						<p class="text-2xs font-semibold text-muted-foreground">เบอร์โทรศัพท์ (CONTACT)</p>
						<p class="font-semibold text-foreground">{volunteer.phone ?? 'ไม่ได้ระบุ'}</p>
					</div>
					<div>
						<p class="text-2xs font-semibold text-muted-foreground">เลขบัตรประชาชน (NATIONAL ID)</p>
						<p class="font-semibold text-foreground">{nationalId}</p>
					</div>
					<div>
						<p class="text-2xs font-semibold text-muted-foreground">สถานะตัวตนปัจจุบัน</p>
						<Badge variant="outline" class={statusClass(identityStatus)}>
							{VERIFICATION_STATUS_LABEL[identityStatus]}
						</Badge>
					</div>
				</div>
			</section>

			<section class="space-y-3 rounded-xl border border-border p-4">
				<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<span class="h-2.5 w-2.5 rounded-full bg-violet-600"></span>
					2. ทักษะวิชาชีพ/ควบคุมที่ยื่นขอ (CONTROLLED SKILLS &amp; LICENSES)
				</h3>
				{#if controlledSkills.length > 0}
					<div class="space-y-2">
						{#each controlledSkills as skill (skill.code)}
							<div class="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
								<div class="flex flex-wrap items-start justify-between gap-2">
									<div class="flex min-w-0 items-start gap-2">
										<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
										<div>
											<p class="text-sm font-semibold text-foreground">{skill.label}</p>
											<p class="text-xs text-muted-foreground">{skill.description}</p>
										</div>
									</div>
									<Badge variant="outline" class="{statusClass(skill.status)} text-2xs">
										{VERIFICATION_STATUS_LABEL[skill.status]}
									</Badge>
								</div>
								<div class="mt-2 text-xs text-violet-900/70">
									<label
										for={`credential-reference-${skill.code}`}
										class="mb-1.5 block font-semibold"
									>
										เลขใบอนุญาต / เลข ว. / เอกสารอ้างอิง
									</label>
									<Input
										id={`credential-reference-${skill.code}`}
										value={credentialReferenceValue(skill.code)}
										oninput={(event) => {
											credentialReferences[skill.code] = event.currentTarget.value;
										}}
										placeholder="ระบุเลขที่ใบอนุญาตประกอบวิชาชีพ / เลข ว. / หมายเหตุวิชาชีพ..."
										class="border-violet-200 bg-background"
									/>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-sky-900"
					>
						<BadgeCheck class="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
						<span>ไม่พบคำขอทักษะควบคุม — ตรวจตัวตนและพิจารณาระดับอาสาทั่วไปได้</span>
					</div>
				{/if}
			</section>

			<section class="space-y-3 rounded-xl border border-border p-4">
				<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<span class="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
					3. ผลการพิจารณาอนุมัติ (REVIEW DECISION OPTIONS)
				</h3>
				<div class="space-y-2">
					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'controlled'
							? 'border-emerald-500 bg-emerald-50/70'
							: 'border-border bg-background hover:bg-muted/30'}"
					>
						<input
							class="mt-1 h-4 w-4 accent-emerald-600"
							type="radio"
							bind:group={decision}
							value="controlled"
						/>
						<span class="min-w-0">
							<span class="flex flex-wrap items-center gap-2 font-semibold text-foreground">
								<span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
								{controlledSkills.length > 0
									? 'อนุมัติผ่านเกณฑ์ทักษะวิชาชีพ/ควบคุม'
									: 'ยืนยันตัวตนและอนุมัติ'}
								<Badge class="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
									>รับรองทักษะอาชีพแล้ว</Badge
								>
							</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								{controlledSkills.length > 0
									? 'ผ่านการรับรองทักษะควบคุมเรียบร้อย และสามารถพิจารณามอบหมายงานที่ตรงทักษะได้'
									: 'ยืนยันตัวตนแล้ว พร้อมเข้าสู่ขั้นตอนพิจารณางาน'}
							</span>
						</span>
					</label>

					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'operational'
							? 'border-sky-500 bg-sky-50/70'
							: 'border-border bg-background hover:bg-muted/30'}"
					>
						<input
							class="mt-1 h-4 w-4 accent-sky-600"
							type="radio"
							bind:group={decision}
							value="operational"
						/>
						<span class="min-w-0">
							<span class="flex flex-wrap items-center gap-2 font-semibold text-foreground">
								<span class="h-2.5 w-2.5 rounded-full bg-sky-500"></span>
								อนุมัติระดับอาสาทั่วไป (Operational Only)
							</span>
							<span class="mt-1 block text-xs text-muted-foreground"
								>ไม่รับรองทักษะควบคุม แต่สามารถช่วยเหลืองานทั่วไปได้</span
							>
						</span>
					</label>

					<label
						class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors {decision ===
						'rejected'
							? 'border-rose-500 bg-rose-50/70'
							: 'border-border bg-background hover:bg-muted/30'}"
					>
						<input
							class="mt-1 h-4 w-4 accent-rose-600"
							type="radio"
							bind:group={decision}
							value="rejected"
						/>
						<span class="min-w-0">
							<span class="flex items-center gap-2 font-semibold text-foreground">
								<span class="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
								ปฏิเสธคำขอ (ไม่ผ่านเกณฑ์)
							</span>
							<span class="mt-1 block text-xs text-rose-700"
								>ไม่ผ่านการตรวจคุณสมบัติหรือเอกสาร จึงไม่ควรให้เข้าปฏิบัติงาน</span
							>
						</span>
					</label>
				</div>

				<div class="space-y-1.5">
					<Label for="qualification-review-notes"
						>หมายเหตุการพิจารณาเพิ่มเติม {#if decision === 'rejected'}<span class="text-destructive"
								>*</span
							>{/if}</Label
					>
					<Textarea
						id="qualification-review-notes"
						bind:value={notes}
						rows={3}
						placeholder="เช่น ตรวจบัตรประชาชนและใบรับรองปฐมพยาบาลแล้ว..."
					/>
					{#if needsReason}
						<p class="text-2xs text-destructive">กรุณาระบุเหตุผลก่อนบันทึกผลไม่ผ่าน</p>
					{/if}
				</div>
			</section>
		</div>

		<div class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isPending}>
				ยกเลิก
			</Button>
			<Button
				type="button"
				class="gap-1.5 text-white {decision === 'rejected'
					? 'bg-rose-600 hover:bg-rose-700'
					: decision === 'operational'
						? 'bg-sky-700 hover:bg-sky-800'
						: 'bg-emerald-600 hover:bg-emerald-700'}"
				disabled={isPending || needsReason}
				onclick={submit}
			>
				{#if decision === 'rejected'}<X class="h-4 w-4" />{:else}<BadgeCheck class="h-4 w-4" />{/if}
				{isPending ? 'กำลังบันทึก...' : decisionLabel}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
