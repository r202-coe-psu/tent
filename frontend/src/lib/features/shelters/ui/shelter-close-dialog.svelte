<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	// Pure entry, not the people barrel: people UI imports the shelters barrel (cycle).
	import { STATUS_LABELS } from '$lib/features/people/server';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { useCloseShelter, useShelterClosePreview } from '../application/queries';
	import { shelterCloseConfirmPhrase, type ShelterCloseResult } from '../domain/shelter-close';
	import {
		canConfirmShelterClose,
		describeShelterCloseResult,
		shelterCloseCountRows,
		shelterCloseDialogOpenChange
	} from '../domain/shelter-close-flow';

	let {
		open = $bindable(false),
		code,
		name,
		onfinish,
		oncancel
	}: {
		open?: boolean;
		code: string;
		name: string;
		/** The close request completed (check `result.closed`); the dialog has already toasted. */
		onfinish?: (result: ShelterCloseResult) => void;
		/** The user dismissed the dialog without closing the shelter. */
		oncancel?: () => void;
	} = $props();

	const preview = useShelterClosePreview(
		() => code,
		() => open
	);
	const closeMutation = useCloseShelter();

	let confirmText = $state('');

	const running = $derived(closeMutation.isPending);
	const phrase = $derived(shelterCloseConfirmPhrase(code, name));
	const rows = $derived(
		preview.data ? shelterCloseCountRows(preview.data.by_status, STATUS_LABELS) : []
	);
	const total = $derived(preview.data?.total ?? 0);
	const canConfirm = $derived(
		canConfirmShelterClose({
			running,
			previewLoaded: !!preview.data,
			typed: confirmText,
			code,
			name
		})
	);

	// FR-19: the dialog cannot be dismissed (escape / outside click / cancel) while the request runs.
	function setOpen(next: boolean) {
		const change = shelterCloseDialogOpenChange(running, next);
		if (change.cancelled) {
			confirmText = '';
			oncancel?.();
		}
		open = change.open;
	}

	async function confirm() {
		if (!canConfirm) return;
		try {
			const result = await closeMutation.mutateAsync({ code, confirmText });
			const outcome = describeShelterCloseResult(result);
			if (outcome.kind === 'success') toast.success(outcome.message);
			else toast.error(outcome.message);
			confirmText = '';
			open = false;
			onfinish?.(result);
		} catch (err) {
			// Request never completed (network / permission / 400): stay open so staff can retry.
			toast.error(err instanceof Error && err.message ? err.message : 'ปิดศูนย์ไม่สำเร็จ');
		}
	}
</script>

<AlertDialog.Root bind:open={() => open, setOpen}>
	<AlertDialog.Content
		class="gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-md sm:max-w-lg"
		escapeKeydownBehavior={running ? 'ignore' : 'close'}
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

		{#if preview.isPending}
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
				disabled={running}
				autocomplete="off"
				placeholder={phrase}
				class="h-11 sm:h-10"
			/>
		</div>

		<AlertDialog.Footer class="rounded-b-2xl">
			<Button
				type="button"
				variant="outline"
				class="min-h-11 sm:min-h-9"
				disabled={running}
				onclick={() => setOpen(false)}
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				class="btn-destructive-brand min-h-11 sm:min-h-9"
				disabled={!canConfirm}
				onclick={confirm}
			>
				{#if running}
					<Loader2 class="h-4 w-4 animate-spin" />
					<span>กำลังปิดศูนย์...</span>
				{:else}
					<span>เช็คเอาต์ทั้งหมดและปิดศูนย์</span>
				{/if}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
