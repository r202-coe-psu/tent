<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isWarehouseStaff, isSystemAdmin } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import type { DistributionRequest } from '../domain/distribution';
	import { useRejectDistributionRequest } from '../application/queries';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import XCircle from '@lucide/svelte/icons/x-circle';

	interface Props {
		open: boolean;
		request: DistributionRequest | null;
		onSuccess?: (request: DistributionRequest) => void;
		onClose?: () => void;
	}

	let { open = $bindable(false), request, onSuccess, onClose }: Props = $props();

	let reason = $state('');

	const userRoles = $derived(authStore.user?.roles ?? []);
	const canReject = $derived(isWarehouseStaff(userRoles) || isSystemAdmin(userRoles));
	const isPendingStatus = $derived(request?.status === 'pending');

	const rejectMutation = useRejectDistributionRequest();

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		if (!isOpen) {
			reason = '';
			onClose?.();
		}
	}

	async function handleConfirmReject() {
		if (rejectMutation.isPending) {
			toast.error('กำลังปฏิเสธคำร้อง โปรดรอให้การดำเนินการปัจจุบันเสร็จสิ้น');
			return;
		}
		if (!canReject) {
			toast.error(
				'คุณไม่มีสิทธิ์ในการปฏิเสธคำร้องนี้ (ต้องมีบทบาท warehouse_staff หรือ system_admin)'
			);
			return;
		}
		if (!request || !isPendingStatus) {
			toast.error('ไม่สามารถปฏิเสธคำร้องได้ เนื่องจากคำร้องไม่ได้อยู่ในสถานะรอดำเนินการ');
			return;
		}
		const trimmedReason = reason.trim();
		if (!trimmedReason) {
			toast.error('กรุณาระบุเหตุผลในการปฏิเสธคำร้อง');
			return;
		}

		const user = authStore.user;
		if (!user?.name) {
			toast.error('ไม่พบข้อมูลผู้ใช้งานที่เข้าสู่ระบบ');
			return;
		}
		const shelterCode = getShelterCode();
		if (request.shelter_code !== shelterCode) {
			toast.error('ไม่สามารถปฏิเสธคำร้องของศูนย์พักพิงอื่นได้');
			return;
		}

		try {
			const result = (await rejectMutation.mutateAsync({
				requestId: request._id,
				reason: trimmedReason,
				ctx: {
					shelterCode,
					createdBy: user.name,
					roles: user.roles
				}
			})) as DistributionRequest;

			toast.success('ปฏิเสธคำร้องเบิกจ่ายเรียบร้อยแล้ว');
			reason = '';
			open = false;
			onSuccess?.(result);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการปฏิเสธคำร้อง';
			toast.error(message);
		}
	}
</script>

<Dialog {open} onOpenChange={handleOpenChange}>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<div class="flex items-center gap-2 text-destructive">
				<XCircle class="size-5" />
				<DialogTitle>ปฏิเสธคำร้องเบิกจ่าย</DialogTitle>
			</div>
			<DialogDescription>
				ยืนยันการปฏิเสธคำร้องเบิกจ่าย การดำเนินการนี้ไม่สามารถย้อนกลับได้
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-4 py-2">
			{#if request}
				<div class="space-y-1 rounded-lg border border-border/80 bg-muted/40 p-3 text-xs">
					<div class="flex items-center justify-between gap-2 font-medium">
						<span class="shrink-0 text-muted-foreground">รหัสคำร้อง:</span>
						<span class="font-mono break-all text-foreground">{request._id}</span>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span class="shrink-0 text-muted-foreground">วัตถุประสงค์:</span>
						<span
							class="max-w-48 truncate font-medium text-foreground sm:max-w-64"
							title={request.purpose}>{request.purpose}</span
						>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span class="shrink-0 text-muted-foreground">ผู้ขอ:</span>
						<span class="truncate text-foreground" title={request.requested_by}
							>{request.requested_by}</span
						>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span class="shrink-0 text-muted-foreground">จำนวนรายการ:</span>
						<span class="font-semibold text-foreground">{request.items.length} รายการ</span>
					</div>
				</div>
			{/if}

			{#if !canReject}
				<div
					class="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
				>
					<AlertTriangle class="size-4 shrink-0" />
					<span>คุณไม่มีสิทธิ์ในการปฏิเสธคำร้อง (เฉพาะเจ้าหน้าที่คลังหรือผู้ดูแลระบบ)</span>
				</div>
			{:else if !isPendingStatus}
				<div
					class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
				>
					<AlertTriangle class="size-4 shrink-0" />
					<span
						>คำร้องนี้ไม่ได้อยู่ในสถานะรอดำเนินการ (สถานะปัจจุบัน: {request?.status ?? '-'})</span
					>
				</div>
			{:else}
				<div class="space-y-1.5">
					<label for="reject-reason" class="text-xs font-semibold text-foreground">
						เหตุผลในการปฏิเสธ <span class="text-destructive">*</span>
					</label>
					<Textarea
						id="reject-reason"
						bind:value={reason}
						placeholder="ระบุเหตุผล เช่น สินค้าในคลังไม่เพียงพอ, คำร้องซ้ำซ้อน ฯลฯ"
						rows={3}
						disabled={rejectMutation.isPending}
						class="text-xs"
					/>
				</div>
			{/if}
		</div>

		<DialogFooter class="flex gap-2 sm:justify-end">
			<Button
				variant="outline"
				size="sm"
				disabled={rejectMutation.isPending}
				onclick={() => handleOpenChange(false)}
			>
				ยกเลิก
			</Button>

			<Button
				variant="destructive"
				size="sm"
				disabled={!canReject || !isPendingStatus || !reason.trim() || rejectMutation.isPending}
				onclick={handleConfirmReject}
				class="gap-1.5"
			>
				{#if rejectMutation.isPending}
					<Loader2 class="size-3.5 animate-spin" />
					กำลังปฏิเสธ...
				{:else}
					<XCircle class="size-3.5" />
					ยืนยันปฏิเสธคำร้อง
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
