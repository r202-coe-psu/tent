<script lang="ts">
	/**
	 * Approve / reject confirmation for one `job_application`
	 * (01-tab-job-board.md §01.5 "คิวอนุมัติผู้สมัคร").
	 *
	 * Wraps `useReviewApplication`, which is the only path that may move an
	 * application out of `pending_review`: confirming consumes one job slot
	 * (`JobRepository#confirmSlot`, compensated on failure — see
	 * `job-application.remote.ts`), rejecting consumes none.
	 *
	 * Approving into a full job is blocked HERE rather than left to the
	 * repository: `confirmSlot` would throw `QuotaError` with an English
	 * developer message, and the SM would see it as a failed click with no
	 * explanation. `computeQuota` is the same pure function the quota bar reads,
	 * so the two can never disagree about whether a seat is left.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Check from '@lucide/svelte/icons/check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import X from '@lucide/svelte/icons/x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { computeQuota } from '../domain/quota';
	import { isControlledSkill } from '../domain/skills';
	import type { Job } from '../domain/job.schema';
	import {
		JOB_APPLICATION_REVIEW_REASON_LABEL,
		type JobApplication
	} from '../domain/job-application.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import {
		identityVerificationStatus,
		skillVerificationStatus,
		VERIFICATION_STATUS_LABEL
	} from '../domain/verification';
	import { useReviewApplication, useSkillOptions } from '../application/queries';

	let {
		open = $bindable(false),
		job,
		application,
		volunteer = null,
		decision
	}: {
		open?: boolean;
		job: Job;
		application: JobApplication | null;
		volunteer?: Volunteer | null;
		decision: 'confirmed' | 'rejected';
	} = $props();

	const queryClient = useQueryClient();
	const reviewMutation = useReviewApplication(queryClient);
	const skillCatalog = useSkillOptions();

	let notes = $state('');

	$effect(() => {
		if (!open) notes = '';
	});

	const approving = $derived(decision === 'confirmed');
	const applicantName = $derived(
		application ? `${application.applicant.first_name} ${application.applicant.last_name}` : ''
	);
	const identityStatus = $derived(volunteer ? identityVerificationStatus(volunteer) : null);
	const skillAuditPending = $derived(
		approving &&
			(application?.review_reasons ?? []).includes('skill_certification') &&
			(!volunteer ||
				(application?.applicant.skills ?? []).some(
					(skill) =>
						isControlledSkill(skill, skillCatalog.controlledValues) &&
						skillVerificationStatus(volunteer, skill) !== 'verified'
				))
	);
	const remaining = $derived(computeQuota(job).remaining);
	const jobFull = $derived(approving && remaining <= 0);
	const notesRequired = $derived(!approving);
	const canSubmit = $derived(
		application !== null &&
			!jobFull &&
			!skillAuditPending &&
			!reviewMutation.isPending &&
			(!notesRequired || notes.trim().length > 0)
	);

	async function submit() {
		if (!application || !canSubmit) return;
		const trimmed = notes.trim();
		try {
			await reviewMutation.mutateAsync({
				id: application._id,
				decision,
				notes: trimmed === '' ? null : trimmed
			});
			toast.success(approving ? `อนุมัติ ${applicantName} แล้ว` : `ปฏิเสธ ${applicantName} แล้ว`);
			open = false;
		} catch (err) {
			// The repository rejects a second review of the same application with a
			// Thai message ("ถูกพิจารณาไปแล้ว") — surface it as-is so two managers
			// racing on one row get the reason, not a generic failure.
			toast.error(
				err instanceof Error ? err.message : approving ? 'อนุมัติไม่สำเร็จ' : 'ปฏิเสธไม่สำเร็จ'
			);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Title class="flex items-center gap-2">
			{#if approving}
				<Check class="h-4.5 w-4.5 text-emerald-600" />
				อนุมัติใบสมัครอาสา
			{:else}
				<X class="h-4.5 w-4.5 text-rose-600" />
				ปฏิเสธใบสมัครอาสา
			{/if}
		</Dialog.Title>
		<p class="text-sm text-muted-foreground">
			{#if approving}
				ยืนยันรับ <span class="font-bold text-foreground">{applicantName}</span> เข้างาน
				<span class="font-bold text-foreground">{job.title}</span> — ระบบจะตัดโควตา 1 ที่นั่งทันที
			{:else}
				ปฏิเสธใบสมัครของ <span class="font-bold text-foreground">{applicantName}</span>
				สำหรับงาน <span class="font-bold text-foreground">{job.title}</span> — โควตาจะไม่ถูกตัด
			{/if}
		</p>

		{#if application}
			<div class="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs font-bold text-foreground">เช็กลิสต์ก่อนอนุมัติงาน</p>
					<span class="text-2xs text-muted-foreground">ตรวจคน ≠ อนุมัติงาน</span>
				</div>
				<div class="grid gap-2 text-xs sm:grid-cols-2">
					<div class="flex items-center gap-2 rounded-lg bg-background p-2">
						{#if identityStatus === 'verified'}
							<CheckCircle2 class="h-4 w-4 text-emerald-600" />
						{:else}
							<CircleAlert class="h-4 w-4 text-amber-600" />
						{/if}
						<span
							>ตัวตน: {identityStatus
								? VERIFICATION_STATUS_LABEL[identityStatus]
								: 'ยังไม่เชื่อมโปรไฟล์'}</span
						>
					</div>
					<div class="flex items-center gap-2 rounded-lg bg-background p-2">
						<CheckCircle2 class="h-4 w-4 text-sky-600" />
						<span>ความเหมาะสมของงาน: ผู้ดูแลงานเป็นผู้ตัดสินใจ</span>
					</div>
				</div>
				{#if (application.review_reasons ?? []).length > 0}
					<p class="text-2xs text-muted-foreground">
						เหตุผลที่เข้าคิว:
						{(application.review_reasons ?? [])
							.map((reason) => JOB_APPLICATION_REVIEW_REASON_LABEL[reason])
							.join(' · ')}
					</p>
				{/if}
			</div>
			{#if skillAuditPending}
				<p class="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
					ต้องตรวจและรับรองทักษะควบคุมก่อน จึงจะอนุมัติเข้างานและตัดโควตาได้
				</p>
			{/if}
		{/if}

		{#if jobFull}
			<div class="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
				<p class="text-xs text-rose-900">
					งานนี้เต็มแล้ว (เหลือ {remaining} ที่นั่ง) — เพิ่มโควตาหรือเพิ่มกะย่อยในแท็บ "กะและตารางกะ"
					ก่อนจึงจะอนุมัติเพิ่มได้
				</p>
			</div>
		{:else if approving}
			<p class="text-xs text-muted-foreground">เหลือที่นั่งว่างอีก {remaining} ที่</p>
		{/if}

		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-foreground">
				หมายเหตุการพิจารณา
				{#if notesRequired}
					<span class="text-destructive">*</span>
				{:else}
					<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
				{/if}
			</span>
			<Textarea
				bind:value={notes}
				rows={3}
				placeholder={approving
					? 'เช่น ตรวจใบรับรองปฐมพยาบาลแล้ว, นัดปฐมนิเทศวันที่...'
					: 'เช่น ทักษะไม่ตรงกับงาน, เอกสารรับรองไม่ครบ, สมัครซ้ำ...'}
			/>
			{#if notesRequired}
				<p class="text-2xs text-muted-foreground">
					ต้องระบุเหตุผลทุกครั้งที่ปฏิเสธ เพื่อให้ตรวจย้อนหลังได้
				</p>
			{/if}
		</div>

		<div class="flex justify-end gap-2 pt-1">
			<Button variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				class={[
					'gap-1.5 text-white',
					approving ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
				]}
				disabled={!canSubmit}
				onclick={submit}
			>
				{approving ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
