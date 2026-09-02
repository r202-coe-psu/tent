<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Users from '@lucide/svelte/icons/users';
	import { toast } from 'svelte-sonner';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import type { AuthorContext } from '$lib/db/model';

	import { useItemMasters } from '$lib/features/catalog';
	import { useDashboardOccupancy } from '$lib/features/dashboard';
	import { useStockBalance } from '$lib/features/operations';

	import { calculateNfiTarget } from '../domain/distribution';
	import { useCreateDistributionRequest } from '../application/queries';
	import {
		createInitialFormState,
		validateCreateRequestForm,
		type CreateRequestFormState
	} from './create-request-form';
	import RequestItemEditor from './request-item-editor.svelte';
	import NfiTemplatePicker from './nfi-template-picker.svelte';

	interface Props {
		open: boolean;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(false), onOpenChange }: Props = $props();

	const shelterCode = $derived(getShelterCode());
	const currentUser = $derived(authStore.user);
	const userName = $derived(currentUser?.name ?? '');
	const userRoles = $derived(currentUser?.roles ?? []);

	// Active Headcount query (from Dashboard public barrel)
	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const activeHeadcount = $derived(occupancyQuery.data ? occupancyQuery.data.active : undefined);

	// Catalog items query (from Catalog public barrel)
	const itemMastersQuery = useItemMasters();
	const itemMasters = $derived(itemMastersQuery.data ?? []);

	// Stock balances query (from Operations public barrel)
	const stockBalanceQuery = useStockBalance();
	const stockBalances = $derived(stockBalanceQuery.data ?? new Map<string, string>());

	// Form State
	let formState = $state<CreateRequestFormState>(createInitialFormState());
	let activeTab = $state<'manual' | 'template'>('manual');
	let formErrors = $state<Record<string, string>>({});

	// Create Request Mutation
	const createMutation = useCreateDistributionRequest();
	const isSubmitting = $derived(createMutation.isPending);

	// NFI Target derived live
	const nfiTarget = $derived.by(() => {
		if (
			activeHeadcount === undefined ||
			activeHeadcount === null ||
			activeHeadcount < 0 ||
			!Number.isInteger(activeHeadcount)
		) {
			return '-';
		}
		try {
			return calculateNfiTarget({
				active_headcount: String(activeHeadcount),
				buffer_percent: formState.bufferPercent
			});
		} catch {
			return '-';
		}
	});

	// Validation summary
	const validationResult = $derived(
		validateCreateRequestForm(formState, activeHeadcount, itemMasters)
	);
	const isFormValid = $derived(validationResult.valid);

	function resetForm() {
		formState = createInitialFormState();
		formErrors = {};
		activeTab = 'manual';
	}

	function handleClose() {
		if (isSubmitting) return;
		open = false;
		onOpenChange?.(false);
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (isSubmitting) return;

		// 1. Auth context verification
		if (!userName) {
			toast.error('ไม่พบข้อมูลผู้ใช้งานที่เข้าสู่ระบบ');
			return;
		}

		// 2. Headcount verification
		if (
			activeHeadcount === undefined ||
			activeHeadcount === null ||
			occupancyQuery.isLoading ||
			occupancyQuery.isError
		) {
			toast.error('ยังโหลดข้อมูลจำนวนผู้พักพิงไม่สำเร็จ');
			return;
		}

		// 3. Catalog verification
		if (itemMastersQuery.isLoading || itemMastersQuery.isError || itemMasters.length === 0) {
			toast.error('ยังโหลดข้อมูลสิ่งของจาก Catalog ไม่สำเร็จ');
			return;
		}

		// 4. Form validation
		const result = validateCreateRequestForm(formState, activeHeadcount, itemMasters);
		formErrors = result.errors;

		if (!result.valid || !result.payload) {
			const firstErrorKey = Object.keys(result.errors)[0];
			const firstErrorMessage = result.errors[firstErrorKey] || 'กรุณาตรวจสอบข้อมูลในฟอร์ม';
			toast.error(firstErrorMessage);
			return;
		}

		const authorCtx: AuthorContext = {
			shelterCode,
			createdBy: userName,
			roles: userRoles
		};

		try {
			await createMutation.mutateAsync({
				input: result.payload,
				ctx: authorCtx
			});

			toast.success('สร้างคำร้องเบิกจ่ายสิ่งของสำเร็จ');
			resetForm();
			open = false;
			onOpenChange?.(false);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างคำร้อง';
			toast.error(message);
			// Form state is preserved on failure
		}
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content class="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold">
				<PackagePlus class="h-5 w-5 text-primary" />
				สร้างคำร้องเบิกจ่ายสิ่งของ (Distribution Request)
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				ระบุวัตถุประสงค์และเลือกรายการสิ่งของจาก Catalog เพื่อส่งคำร้องรอการอนุมัติและจัดสรรสต็อก
			</Dialog.Description>
		</Dialog.Header>

		<!-- System-Derived Context Strip -->
		<div
			class="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/40 p-3 sm:grid-cols-3"
		>
			<div class="space-y-0.5">
				<span class="text-[11px] font-medium text-muted-foreground">ผู้ขอเบิก (Requester)</span>
				<div class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
					<span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
					{userName || 'ไม่ได้เข้าสู่ระบบ'}
				</div>
			</div>

			<div class="space-y-0.5">
				<span class="text-[11px] font-medium text-muted-foreground">ศูนย์พักพิง (Shelter)</span>
				<div class="text-xs font-semibold text-foreground">
					{shelterCode || '-'}
				</div>
			</div>

			<div class="space-y-0.5">
				<span class="text-[11px] font-medium text-muted-foreground"
					>ผู้พักพิงปัจจุบัน (Active Headcount)</span
				>
				<div class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
					<Users class="h-3.5 w-3.5 text-primary" />
					{#if occupancyQuery.isLoading}
						<span class="flex items-center gap-1 text-muted-foreground">
							<Loader2 class="h-3 w-3 animate-spin" /> กำลังโหลด...
						</span>
					{:else if occupancyQuery.isError || activeHeadcount === undefined}
						<span class="text-destructive">ไม่พบข้อมูล</span>
					{:else}
						<span class="text-foreground">{activeHeadcount.toLocaleString()} คน</span>
					{/if}
				</div>
			</div>
		</div>

		<form onsubmit={handleSubmit} class="space-y-5">
			<!-- Purpose & Note -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="purpose-input" class="text-xs font-semibold text-foreground">
						วัตถุประสงค์การเบิกจ่าย <span class="text-destructive">*</span>
					</label>
					<Input
						id="purpose-input"
						placeholder="เช่น เบิกจ่ายน้ำดื่มและของใช้ประจำวัน โซน A"
						class="h-9 text-sm {formErrors.purpose ? 'border-destructive' : ''}"
						bind:value={formState.purpose}
						disabled={isSubmitting}
					/>
					{#if formErrors.purpose}
						<p class="text-[11px] font-medium text-destructive">{formErrors.purpose}</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<label for="note-input" class="text-xs font-semibold text-foreground">
						หมายเหตุเพิ่มเติม (ถ้ามี)
					</label>
					<Input
						id="note-input"
						placeholder="เช่น นัดรับเวลา 14:00 น."
						class="h-9 text-sm"
						bind:value={formState.note}
						disabled={isSubmitting}
					/>
				</div>
			</div>

			<!-- Buffer & Calculated Target Info -->
			<div class="space-y-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div class="space-y-0.5">
						<span class="text-xs font-semibold text-foreground"
							>ค่าเผื่อสำรอง (Buffer Percentage)</span
						>
						<p class="text-[11px] text-muted-foreground">
							เลือกเปอร์เซ็นต์สำรองสำหรับรองรับผู้พักพิงเพิ่มเติม (5% - 10%)
						</p>
					</div>

					<div class="flex items-center gap-1.5">
						{#each [5, 10] as buf (buf)}
							<button
								type="button"
								class="h-7 min-w-8 rounded-md border text-xs font-medium transition-colors {formState.bufferPercent ===
								buf
									? 'border-primary bg-primary font-semibold text-primary-foreground shadow-2xs'
									: 'border-border bg-background text-muted-foreground hover:bg-muted'}"
								disabled={isSubmitting}
								onclick={() => (formState.bufferPercent = buf)}
							>
								{buf}%
							</button>
						{/each}
					</div>
				</div>

				<div class="flex items-center justify-between border-t border-primary/10 pt-2 text-xs">
					<span class="text-muted-foreground">เป้าหมายคำนวณ NFI (Active + Buffer):</span>
					<span class="font-bold text-primary">
						{#if nfiTarget !== '-'}
							{nfiTarget} หน่วย
							<span class="text-[11px] font-normal text-muted-foreground">
								({activeHeadcount} คน + {formState.bufferPercent}%)
							</span>
						{:else}
							-
						{/if}
					</span>
				</div>
			</div>

			<!-- Tab switch: Manual vs NFI Template -->
			<div class="flex border-b border-border text-xs font-medium">
				<button
					type="button"
					class="flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors {activeTab ===
					'manual'
						? 'border-primary font-semibold text-primary'
						: 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => (activeTab = 'manual')}
				>
					<span>กำหนดรายการเอง (Manual)</span>
				</button>
				<button
					type="button"
					class="flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors {activeTab ===
					'template'
						? 'border-primary font-semibold text-primary'
						: 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => (activeTab = 'template')}
				>
					<span>เทมเพลตมาตรฐาน NFI</span>
					<Badge
						variant="outline"
						class="h-4 border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
					>
						4
					</Badge>
				</button>
			</div>

			{#if activeTab === 'manual'}
				{#if itemMastersQuery.isLoading}
					<div class="flex items-center justify-center py-8 text-xs text-muted-foreground">
						<Loader2 class="mr-2 h-4 w-4 animate-spin" /> กำลังโหลดรายการสิ่งของจาก Catalog...
					</div>
				{:else if itemMastersQuery.isError}
					<div
						class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
					>
						ไม่สามารถโหลดข้อมูล Catalog ได้: {itemMastersQuery.error?.message}
					</div>
				{:else}
					<RequestItemEditor
						bind:items={formState.items}
						{itemMasters}
						{stockBalances}
						targetQty={nfiTarget}
						disabled={isSubmitting}
						errors={formErrors}
					/>
				{/if}
			{:else}
				<NfiTemplatePicker disabled={isSubmitting} />
			{/if}

			<!-- Actions -->
			<Dialog.Footer class="gap-2 pt-3">
				<Button type="button" variant="outline" disabled={isSubmitting} onclick={handleClose}>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={isSubmitting ||
						!isFormValid ||
						occupancyQuery.isLoading ||
						itemMastersQuery.isLoading}
					class="gap-1.5"
				>
					{#if isSubmitting}
						<Loader2 class="h-4 w-4 animate-spin" />
						กำลังบันทึก...
					{:else}
						<CheckCircle2 class="h-4 w-4" />
						สร้างคำร้องเบิกจ่าย
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
