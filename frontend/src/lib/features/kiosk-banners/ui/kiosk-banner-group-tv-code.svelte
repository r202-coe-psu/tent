<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { useRotateTvCode } from '../application/kiosk-banner.queries';
	import type { KioskBannerGroupSummary } from '../data/kiosk-banner.repository';
	import { internalBannerUrl } from '../domain/kiosk-banner-group';

	/**
	 * The group's TV pairing code and the link a TV opens: staff copy the link, or the TV user
	 * types the code on the code-entry page.
	 */
	let { group, origin }: { group: KioskBannerGroupSummary; origin: string } = $props();

	/** A v1 group has no code until the server's lazy backfill on read. */
	const groupTvCode = $derived('tv_code' in group ? group.tv_code : null);

	/**
	 * Shows a rotated code at once, but only while `group` still carries the code it replaced:
	 * any fresher prop (the refetch, or a rotation elsewhere) takes over again.
	 */
	let rotated = $state<{ from: string | null; to: string } | null>(null);
	const tvCode = $derived(rotated && rotated.from === groupTvCode ? rotated.to : groupTvCode);
	const link = $derived(tvCode ? internalBannerUrl(origin, group.shelter_code, tvCode) : null);

	const rotate = useRotateTvCode();
	let rotateOpen = $state(false);

	/** A failed call is already toasted by the mutation hook. */
	async function confirmRotate() {
		try {
			const updated = await rotate.mutateAsync({ id: group._id });
			if ('tv_code' in updated) rotated = { from: groupTvCode, to: updated.tv_code };
		} catch {
			return;
		}
		rotateOpen = false;
		toast.success('ออกรหัสใหม่แล้ว');
	}

	async function copyLink() {
		if (!link) return;
		try {
			// `navigator.clipboard` is missing off a secure context (plain http on the LAN).
			await navigator.clipboard.writeText(link);
		} catch {
			toast.error('คัดลอกไม่สำเร็จ');
			return;
		}
		toast.success('คัดลอกลิงก์แล้ว');
	}
</script>

<section
	class="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
	aria-label="รหัสจอ TV"
>
	<h2 class="text-sm font-semibold text-slate-700">รหัสจอ TV</h2>
	{#if tvCode && link}
		<p class="text-3xl font-bold tracking-widest text-slate-900 tabular-nums">{tvCode}</p>
		<p class="text-sm break-all text-slate-600">{link}</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" class="min-h-11 gap-2" onclick={copyLink}>
				<Copy class="size-4" aria-hidden="true" />
				คัดลอกลิงก์
			</Button>
			<Button variant="outline" class="min-h-11 gap-2" onclick={() => (rotateOpen = true)}>
				<RefreshCw class="size-4" aria-hidden="true" />
				ออกรหัสใหม่
			</Button>
		</div>
	{/if}
</section>

<AlertDialog.Root bind:open={rotateOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" aria-hidden="true" />
				<AlertDialog.Title>ออกรหัสใหม่?</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="pt-2 text-sm">
				รหัสเดิมจะใช้ไม่ได้ทันที จอที่เปิดรหัสเดิมอยู่จะกลับไปหน้ากรอกรหัส
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				disabled={rotate.isPending}
				onclick={(event) => {
					// Keep the dialog open until the call succeeds; AlertDialog.Action closes on click.
					event.preventDefault();
					void confirmRotate();
				}}
			>
				ออกรหัสใหม่
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
