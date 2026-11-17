<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { ServiceRequestError } from '$lib/api/service';
	// Pure client-safe entry, not the people barrel: people UI imports the shelters barrel (cycle).
	import { STATUS_LABELS } from '$lib/features/people/pure';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		announceShelterCloseJob,
		useCloseShelter,
		useShelterCloseJob,
		useShelterClosePreview
	} from '../application/queries';
	import { shelterCloseConfirmPhrase } from '../domain/shelter-close';
	import { isShelterCloseJobActive, type ShelterCloseJobView } from '../domain/shelter-close-job';
	import {
		canConfirmShelterClose,
		shelterCloseCountRows,
		shelterCloseJobPhaseLabel,
		shelterCloseJobProgress
	} from '../domain/shelter-close-flow';

	let {
		open = $bindable(false),
		code,
		name,
		resumeJobId,
		onfinish,
		oncancel
	}: {
		open?: boolean;
		code: string;
		name: string;
		/** A close job that is already running: the dialog opens straight on its progress. */
		resumeJobId?: string | null;
		/** The job reached a terminal status (check `view.closed`); the dialog has already toasted. */
		onfinish?: (view: ShelterCloseJobView) => void;
		/** The user dismissed the dialog before the job finished (the job keeps running). */
		oncancel?: () => void;
	} = $props();

	let confirmText = $state('');
	let startedJobId = $state<string | null>(null);
	let handledJobId: string | null = null;

	const jobId = $derived(startedJobId ?? resumeJobId ?? null);

	const preview = useShelterClosePreview(
		() => code,
		() => open && !jobId
	);
	const closeMutation = useCloseShelter();

	const job = useShelterCloseJob(
		() => code,
		() => jobId,
		() => open
	);
	const view = $derived(job.data);
	const progress = $derived(view ? shelterCloseJobProgress(view) : null);

	const starting = $derived(closeMutation.isPending);
	const phrase = $derived(shelterCloseConfirmPhrase(code, name));
	const rows = $derived(
		preview.data ? shelterCloseCountRows(preview.data.by_status, STATUS_LABELS) : []
	);
	const total = $derived(preview.data?.total ?? 0);
	const canConfirm = $derived(
		canConfirmShelterClose({
			running: starting,
			previewLoaded: !!preview.data,
			typed: confirmText,
			code,
			name
		})
	);

	// FR-27: once the job is terminal, toast (once per job) and hand the result to the form.
	$effect(() => {
		const current = view;
		if (!open || !current || isShelterCloseJobActive(current) || handledJobId === current.job_id) {
			return;
		}
		handledJobId = current.job_id;
		announceShelterCloseJob(current);
		confirmText = '';
		startedJobId = null;
		open = false;
		onfinish?.(current);
	});

	// The modal can be dismissed while the job runs (FR-27); only the short start request blocks it.
	function setOpen(next: boolean) {
		if (starting) {
			open = true;
			return;
		}
		if (!next) {
			confirmText = '';
			startedJobId = null;
			oncancel?.();
		}
		open = next;
	}

	async function confirm() {
		if (!canConfirm) return;
		try {
			const started = await closeMutation.mutateAsync({ code, confirmText });
			startedJobId = started.job_id;
		} catch (err) {
			if (err instanceof ServiceRequestError && err.status === 409) {
				// FR-7: a job is already active — follow it instead of starting a second one.
				const latest = await preview.refetch();
				const activeId = latest.data?.active_job?.job_id;
				if (activeId) {
					startedJobId = activeId;
					return;
				}
			}
			// Request never completed (network / permission / 400): stay open so staff can retry.
			toast.error(err instanceof Error && err.message ? err.message : 'ปิดศูนย์ไม่สำเร็จ');
		}
	}
</script>

<AlertDialog.Root bind:open={() => open, setOpen}>
	<AlertDialog.Content
		class="gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-md sm:max-w-lg"
		escapeKeydownBehavior={starting ? 'ignore' : 'close'}
		interactOutsideBehavior="ignore"
	>
		<AlertDialog.Header class="space-y-2 text-left">
			<AlertDialog.Title class="text-lg font-bold text-slate-900">
				ยืนยันปิดศูนย์ {name}
			</AlertDialog.Title>
			<AlertDialog.Description class="text-sm text-slate-600">
				การปิดศูนย์จะเปลี่ยนสถานะของผู้พักพิงทุกคนที่ยังอยู่ในศูนย์นี้
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if jobId}
			<div class="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4" role="status">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
					<Loader2 class="h-4 w-4 animate-spin text-[#0284C7]" />
					<span>
						กำลังปิดศูนย์{view ? ` · ${shelterCloseJobPhaseLabel(view.phase)}` : '...'}
					</span>
				</div>
				{#if view && progress}
					<div
						class="h-2 overflow-hidden rounded-full bg-sky-100"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={progress.percent}
					>
						<div class="h-full bg-[#0284C7]" style:width="{progress.percent}%"></div>
					</div>
					<p class="text-sm text-slate-800 tabular-nums">
						เช็คเอาต์ {view.counters.checked_out} / {view.preview.total} · ยกเลิก
						{view.counters.cancelled} · ล้มเหลว {view.counters.failed}
					</p>
				{/if}
				<p class="text-xs text-slate-600">
					ปิดหน้าต่างนี้ได้ งานปิดศูนย์จะทำต่อจนเสร็จและแจ้งผลให้ทราบ
				</p>
			</div>
		{:else if preview.isPending}
			<div class="flex items-center gap-2 text-sm text-slate-500" role="status">
				<Loader2 class="h-4 w-4 animate-spin text-[#0284C7]" />
				<span>กำลังนับจำนวนผู้พักพิง...</span>
			</div>
		{:else if preview.isError}
			<div
				class="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
				role="alert"
			>
				<span>{preview.error?.message || 'โหลดจำนวนผู้พักพิงไม่สำเร็จ'}</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="shrink-0"
					onclick={() => preview.refetch()}
				>
					ลองใหม่
				</Button>
			</div>
		{:else if total > 0}
			<div class="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
				<p class="text-sm font-semibold text-amber-900">
					ผู้พักพิงที่จะได้รับผลกระทบ <span class="tabular-nums">{total}</span> คน
				</p>
				<ul class="space-y-1 text-sm text-slate-800">
					{#each rows as row (row.status)}
						<li class="flex items-center justify-between gap-3">
							<span>{row.label}</span>
							<span class="font-semibold tabular-nums">{row.count} คน</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if !jobId}
			<div
				class="flex items-start gap-2 rounded-xl border border-red-200 bg-white p-3 text-sm text-slate-700"
			>
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
				<p>
					ทุกคนที่แสดงด้านบนจะถูกเปลี่ยนเป็น <strong>เช็คเอาต์</strong>
					(ผู้ลงทะเบียนล่วงหน้าจะเป็น <strong>ยกเลิก</strong>) และ
					<strong>การเปิดศูนย์อีกครั้งจะไม่คืนสถานะของพวกเขา</strong>
				</p>
			</div>

			<div class="space-y-1.5">
				<Label for="shelter-close-confirm" class="text-sm font-semibold text-slate-700">
					พิมพ์ข้อความต่อไปนี้เพื่อยืนยัน
				</Label>
				<p
					class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold break-words text-slate-900 select-all"
				>
					{phrase}
				</p>
				<Input
					id="shelter-close-confirm"
					bind:value={confirmText}
					disabled={starting}
					autocomplete="off"
					placeholder={phrase}
					class="h-11 sm:h-10"
				/>
			</div>
		{/if}

		<AlertDialog.Footer class="rounded-b-2xl">
			<Button
				type="button"
				variant="outline"
				class="min-h-11 sm:min-h-9"
				disabled={starting}
				onclick={() => setOpen(false)}
			>
				{jobId ? 'ปิดหน้าต่าง' : 'ยกเลิก'}
			</Button>
			{#if !jobId}
				<Button
					type="button"
					class="btn-destructive-brand min-h-11 sm:min-h-9"
					disabled={!canConfirm}
					onclick={confirm}
				>
					{#if starting}
						<Loader2 class="h-4 w-4 animate-spin" />
						<span>กำลังเริ่มปิดศูนย์...</span>
					{:else}
						<span>เช็คเอาต์ทั้งหมดและปิดศูนย์</span>
					{/if}
				</Button>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
