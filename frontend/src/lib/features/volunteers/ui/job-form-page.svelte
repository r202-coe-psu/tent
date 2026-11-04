<script lang="ts">
	/**
	 * Full-page job create / edit (#639) — `/back-office/volunteers/jobs/new` and
	 * `/back-office/volunteers/jobs/[id]/edit`. Replaces the modal the job board and
	 * the job detail page used to open: the form is long, and a stray click outside
	 * a modal lost the input.
	 *
	 * Save goes to the job's detail page; cancel goes back to wherever the user came
	 * from (or a sensible page when they deep-linked straight here). `JobForm` itself
	 * asks before leaving with unsaved changes.
	 */
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import JobForm from './job-form.svelte';
	import { useJob } from '../application/queries';
	import type { Job } from '../domain/job.schema';

	/** Absent = create a new job; present = edit that job. */
	let { jobId }: { jobId?: string } = $props();

	const isEdit = $derived(jobId !== undefined);
	const jobQuery = useJob(() => jobId ?? '');
	const job = $derived(jobQuery.data ?? null);

	/** False when the page was opened directly (deep link / refresh) — nothing to go back to. */
	let cameFromApp = false;

	afterNavigate(({ from }) => {
		cameFromApp = from !== null;
	});

	// `resolve()` here only prefixes `base`, so ids are interpolated by hand
	// (same as `job-card.svelte`).

	function goBack() {
		if (cameFromApp) {
			history.back();
		} else if (jobId) {
			void goto(resolve(`/back-office/volunteers/jobs/${encodeURIComponent(jobId)}`));
		} else {
			void goto(resolve('/back-office/volunteers'));
		}
	}

	function handleSaved(saved: Job) {
		// Replace, so Back from the detail page returns to the board, not to this form.
		void goto(resolve(`/back-office/volunteers/jobs/${encodeURIComponent(saved._id)}`), {
			replaceState: true
		});
	}
</script>

<StaffPageShell
	title={isEdit ? 'แก้ไขงานอาสาสมัคร' : 'ประกาศงานอาสาสมัครใหม่'}
	description={isEdit
		? (job?.title ?? undefined)
		: 'กรอกรายละเอียดงานอาสาสมัคร ทักษะที่ต้องการ และตารางกะ แล้วกดบันทึกเพื่อเผยแพร่'}
	maxWidth="6xl"
>
	{#snippet actions()}
		<Button variant="outline" class="min-h-11 gap-1.5 rounded-xl" onclick={goBack}>
			<ArrowLeft class="h-4 w-4 shrink-0" />
			ย้อนกลับ
		</Button>
	{/snippet}

	{#if !isEdit}
		<JobForm oncancel={goBack} onsaved={handleSaved} />
	{:else if jobQuery.isPending}
		<Skeleton class="h-96 w-full rounded-xl" />
	{:else if jobQuery.isError}
		<p
			class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
		>
			โหลดข้อมูลงานไม่สำเร็จ: {jobQuery.error instanceof Error
				? jobQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else if !job}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground"
		>
			<p class="text-sm font-medium">ไม่พบงานอาสาสมัครนี้ในศูนย์ที่เลือก</p>
			<Button variant="outline" size="sm" onclick={() => goto(resolve('/back-office/volunteers'))}>
				กลับไปหน้ากระดานงานอาสา
			</Button>
		</div>
	{:else}
		<!-- Keyed so a different job never reuses another job's form state. -->
		{#key job._id}
			<JobForm {job} oncancel={goBack} onsaved={handleSaved} />
		{/key}
	{/if}
</StaffPageShell>
