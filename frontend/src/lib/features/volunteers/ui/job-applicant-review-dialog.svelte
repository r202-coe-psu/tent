<script lang="ts">
	/**
	 * Approve / reject confirmation for one applicant's `job_application`s
	 * (01-tab-job-board.md §01.5 "คิวอนุมัติผู้สมัคร").
	 *
	 * `applications` are one person's applications for this job, one per shift: a single one
	 * from a shift's own buttons, or every pending one from "อนุมัติทุกกะ" (#716). Several are
	 * reviewed one after another (`reviewInOrder`); a shift that fails is reported and the
	 * rest still go through.
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
	import Info from '@lucide/svelte/icons/info';
	import X from '@lucide/svelte/icons/x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { computeQuota } from '../domain/quota';
	import { isControlledSkill } from '../domain/skills';
	import { checkRequiredSkills, REQUIRED_SKILL_STATE_LABEL } from '../domain/required-skills';
	import type { Job } from '../domain/job.schema';
	import {
		JOB_APPLICATION_REVIEW_REASON_LABEL,
		outstandingReviewReasons,
		type JobApplication
	} from '../domain/job-application.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import {
		identityVerificationStatus,
		skillVerificationStatus,
		VERIFICATION_STATUS_LABEL
	} from '../domain/verification';
	import { useReviewApplication, useSkillOptions } from '../application/queries';
	import { reviewInOrder } from '../application/review-batch';

	let {
		open = $bindable(false),
		job,
		applications,
		volunteer = null,
		decision
	}: {
		open?: boolean;
		job: Job;
		/** One applicant's applications for this job; empty while nothing is under review. */
		applications: JobApplication[];
		volunteer?: Volunteer | null;
		decision: 'confirmed' | 'rejected';
	} = $props();

	const queryClient = useQueryClient();
	const reviewMutation = useReviewApplication(queryClient);
	const skillCatalog = useSkillOptions();

	let notes = $state('');
	/** Held across a batch, where `reviewMutation.isPending` drops between applications. */
	let submitting = $state(false);

	$effect(() => {
		if (!open) notes = '';
	});

	/** The person-level checks (identity, skills) read the first; they are one applicant's. */
	const application = $derived<JobApplication | null>(applications[0] ?? null);
	const several = $derived(applications.length > 1);
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
	/** The applicant listed a certificate skill whose check has not passed yet. */
	const uncertifiedSkill = $derived(
		(application?.applicant.skills ?? []).some(
			(skill) =>
				isControlledSkill(skill, skillCatalog.controlledValues) &&
				(!volunteer || skillVerificationStatus(volunteer, skill) !== 'verified')
		)
	);
	const openReasons = $derived(
		outstandingReviewReasons(application?.review_reasons ?? [], {
			identityVerified: identityStatus === 'verified',
			uncertifiedSkill
		})
	);
	/** Each skill the job asks for, against what this applicant claimed (warning only). */
	const requiredChecks = $derived(
		checkRequiredSkills(
			job.skills_required ?? [],
			application?.applicant.skills ?? [],
			skillCatalog.options,
			volunteer
		)
	);
	const missingCertifiedSkill = $derived(
		requiredChecks.some((check) => check.controlled && check.state === 'missing')
	);
	const requiredSkillsShort = $derived(
		requiredChecks.some((check) => check.state !== 'has' && check.state !== 'certified')
	);
	const remaining = $derived(computeQuota(job).remaining);
	const jobFull = $derived(approving && remaining <= 0);
	const notesRequired = $derived(!approving);
	const canSubmit = $derived(
		application !== null &&
			!jobFull &&
			!skillAuditPending &&
			!reviewMutation.isPending &&
			!submitting &&
			(!notesRequired || notes.trim().length > 0)
	);

	function shiftText(item: JobApplication): string {
		const shift = item.selected_shift;
		return `${shift.date} ${shift.start_time}-${shift.end_time} น.`;
	}

	async function submit() {
		if (!application || !canSubmit) return;
		const trimmed = notes.trim();
		if (several) {
			submitting = true;
			const { done, failed } = await reviewInOrder(applications, (item) =>
				reviewMutation.mutateAsync({
					id: item._id,
					decision,
					notes: trimmed === '' ? null : trimmed
				})
			).finally(() => (submitting = false));
			if (done.length > 0) {
				toast.success(
					approving
						? `อนุมัติ ${applicantName} แล้ว ${done.length} กะ`
						: `ปฏิเสธ ${applicantName} แล้ว ${done.length} กะ`
				);
			}
			for (const failure of failed) {
				toast.error(`กะ ${shiftText(failure.application)} ไม่สำเร็จ`, {
					description: failure.message
				});
			}
			if (failed.length === 0) open = false;
			return;
		}
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
				อนุมัติการเข้าร่วมงาน
			{:else}
				<X class="h-4.5 w-4.5 text-rose-600" />
				ปฏิเสธการเข้าร่วมงาน
			{/if}
		</Dialog.Title>
		<p class="text-sm text-muted-foreground">
			{#if approving}
				รับ <span class="font-bold text-foreground">{applicantName}</span> เข้างาน
				<span class="font-bold text-foreground">{job.title}</span>
			{:else}
				ปฏิเสธการเข้าร่วมงานของ <span class="font-bold text-foreground">{applicantName}</span>
				สำหรับงาน <span class="font-bold text-foreground">{job.title}</span>
			{/if}
		</p>

		{#if several}
			<div class="space-y-1 text-xs">
				<p class="font-semibold text-foreground">
					{approving ? 'กะที่จะอนุมัติ' : 'กะที่จะปฏิเสธ'} ({applications.length} กะ)
				</p>
				<ul class="space-y-0.5 text-muted-foreground tabular-nums">
					{#each applications as item (item._id)}
						<li>{shiftText(item)}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if application}
			<div class="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
				<div class="space-y-0.5">
					<p class="text-xs font-bold text-foreground">สิ่งที่ควรตัดสินใจก่อนอนุมัติ</p>
				</div>
				<div class="grid gap-2 text-xs sm:grid-cols-2">
					<div class="flex items-start gap-2 rounded-lg bg-background p-2">
						{#if identityStatus === 'verified'}
							<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
						{:else}
							<CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
						{/if}
						<div class="space-y-0.5">
							<p class="font-semibold text-foreground">ยืนยันตัวตน</p>
							<p class="text-muted-foreground">ตรวจบัตรประชาชนตัวจริง</p>
							<p
								class={[
									'font-semibold',
									identityStatus === 'verified' ? 'text-emerald-700' : 'text-amber-800'
								]}
							>
								{identityStatus
									? VERIFICATION_STATUS_LABEL[identityStatus]
									: 'ยังไม่มีข้อมูลอาสาในระบบ'}
							</p>
						</div>
					</div>
					<div class="flex items-start gap-2 rounded-lg bg-background p-2">
						<Info class="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
						<div class="space-y-0.5">
							<p class="font-semibold text-foreground">ความเหมาะสมของงาน:</p>
							<p class="text-muted-foreground">ผู้อนุมัติเป็นผู้พิจารณา</p>
						</div>
					</div>
					{#if requiredChecks.length > 0}
						<div class="flex items-start gap-2 rounded-lg bg-background p-2 sm:col-span-2">
							{#if requiredSkillsShort}
								<CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
							{:else}
								<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
							{/if}
							<div class="min-w-0 space-y-1">
								<p class="font-semibold text-foreground">ทักษะที่งานนี้ต้องการ</p>
								<ul class="space-y-1">
									{#each requiredChecks as check (check.code)}
										<li>
											<p class="text-foreground">
												{check.label}
												{#if check.controlled}
													<span class="text-muted-foreground">(ต้องมีใบรับรอง)</span>
												{/if}
											</p>
											<p
												class={[
													'font-semibold',
													check.state === 'has' || check.state === 'certified'
														? 'text-emerald-700'
														: 'text-amber-800'
												]}
											>
												{REQUIRED_SKILL_STATE_LABEL[check.state]}
											</p>
										</li>
									{/each}
								</ul>
								{#if missingCertifiedSkill}
									<p class="text-muted-foreground">
										ผู้สมัครไม่มีทักษะที่ต้องมีใบรับรองบางข้อ(ยังอนุมัติได้
										ถ้ารับเข้าเป็นผู้ช่วยงานทั่วไป)
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
				{#if openReasons.length > 0}
					<div class="text-xs text-muted-foreground">
						<p>ใบสมัครนี้ต้องมีคนตรวจเพราะ</p>
						<ul class="mt-0.5 list-disc space-y-0.5 pl-5">
							{#each openReasons as reason (reason)}
								<li>{JOB_APPLICATION_REVIEW_REASON_LABEL[reason]}</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">ไม่มีสิ่งที่ต้องตรวจเพิ่ม</p>
				{/if}
			</div>
			{#if skillAuditPending}
				<div
					class="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
					role="status"
				>
					<p class="font-semibold">ยังอนุมัติไม่ได้ (ต้องตรวจใบรับรองทักษะก่อน)</p>
					<p>
						ผู้สมัครระบุทักษะที่ต้องมีใบรับรอง เช่น การแพทย์ ให้ไปที่แท็บ "รายชื่อและการอนุมัติ"
						กดปุ่ม "ตรวจสอบ &amp; อนุมัติ" ของผู้สมัครคนนี้ แล้วกลับมาอนุมัติเข้างานอีกครั้ง
					</p>
				</div>
			{/if}
		{/if}

		{#if jobFull}
			<div class="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
				<p class="text-xs text-rose-900">
					งานนี้รับคนครบแล้ว(หากต้องการรับเพิ่ม ให้เพิ่มจำนวนคนที่รับหรือเพิ่มกะในแท็บ
					"กะและตารางกะ")
				</p>
			</div>
		{:else if approving}
			<p class="text-xs text-muted-foreground">ตอนนี้งานนี้ยังรับได้อีก {remaining} คน</p>
			{#if several && remaining < applications.length}
				<p class="text-xs text-amber-800">
					อนุมัติได้ไม่ครบ {applications.length} กะ — กะที่เกินจำนวนที่รับได้จะไม่สำเร็จ และระบบจะแจ้งว่ากะไหน
				</p>
			{/if}
		{/if}

		<div class="space-y-1.5">
			<Label for="applicant-review-notes" class="text-xs font-semibold text-foreground">
				{approving ? 'บันทึกเพิ่มเติม' : 'เหตุผลที่ปฏิเสธ'}
				{#if notesRequired}
					<span class="text-destructive">*</span>
				{:else}
					<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
				{/if}
			</Label>
			<Textarea
				id="applicant-review-notes"
				bind:value={notes}
				rows={3}
				placeholder={approving
					? 'เช่น ตรวจใบรับรองปฐมพยาบาลแล้ว, นัดปฐมนิเทศวันที่...'
					: 'เช่น ทักษะไม่ตรงกับงาน, เอกสารรับรองไม่ครบ, สมัครซ้ำ...'}
			/>
			{#if notesRequired}
				<p class="text-xs text-muted-foreground">
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
				{approving
					? several
						? `ยืนยันอนุมัติ ${applications.length} กะ`
						: 'ยืนยันอนุมัติ'
					: 'ยืนยันปฏิเสธ'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
