<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchX from '@lucide/svelte/icons/search-x';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		hasStaffCapability,
		isShelterManager,
		isSystemAdmin,
		isWarehouseStaff
	} from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import type { DistributionRequest } from '../domain/distribution';
	import {
		useCancelDistributionRequest,
		useDistributionBatches,
		useDistributionRequests
	} from '../application/queries';
	import RequestFilters from './request-filters.svelte';
	import RequestStatsHeader from './request-stats-header.svelte';
	import RequestTable from './request-table.svelte';
	import CreateRequestDialog from './create-request-dialog.svelte';
	import ApprovalDialog from './approval-dialog.svelte';
	import RequestDetailDialog from './request-detail-dialog.svelte';
	import RejectRequestDialog from './reject-request-dialog.svelte';
	import { deriveApprovalCoverage, type CoverageKind } from './approval-coverage';
	import {
		filterDistributionRequests,
		type RequestCoverageFilter,
		type RequestSortOrder,
		type RequestStatusFilter
	} from './request-ui';
	import { SvelteMap } from 'svelte/reactivity';

	const userRoles = $derived(authStore.user?.roles ?? []);
	const canCreateRequest = $derived(
		isSystemAdmin(userRoles) ||
			isShelterManager(userRoles) ||
			hasStaffCapability(userRoles, 'registration_staff')
	);
	const canApprove = $derived(isSystemAdmin(userRoles) || isWarehouseStaff(userRoles));
	const canReject = $derived(isSystemAdmin(userRoles) || isWarehouseStaff(userRoles));
	const canCancel = $derived(
		isSystemAdmin(userRoles) ||
			isShelterManager(userRoles) ||
			hasStaffCapability(userRoles, 'registration_staff')
	);

	let isCreateOpen = $state(false);
	let isApprovalOpen = $state(false);
	let approvingRequest = $state<DistributionRequest | null>(null);

	let isDetailOpen = $state(false);
	let selectedDetailRequest = $state<DistributionRequest | null>(null);

	let isRejectOpen = $state(false);
	let selectedRejectRequest = $state<DistributionRequest | null>(null);

	const cancelMutation = useCancelDistributionRequest();

	let search = $state('');
	let status = $state<RequestStatusFilter>('all');
	let coverage = $state<RequestCoverageFilter>('all');
	let sort = $state<RequestSortOrder>('newest');
	const requestQuery = useDistributionRequests(
		() => (status === 'all' ? undefined : status),
		() => getShelterCode()
	);
	const requests = $derived(requestQuery.data ?? []);

	// Bulk-fetch all batches for approved requests in one query without N+1
	const approvedBatchIds = $derived(
		requests
			.filter((r) => r.status === 'approved' && typeof r.batch_id === 'string')
			.map((r) => r.batch_id!)
	);
	const batchesQuery = useDistributionBatches(
		() => approvedBatchIds,
		() => getShelterCode()
	);
	const batchesMap = $derived(new SvelteMap((batchesQuery.data ?? []).map((b) => [b._id, b])));

	const coverageMap = $derived.by<ReadonlyMap<string, CoverageKind | 'unknown'>>(() => {
		const map = new SvelteMap<string, CoverageKind | 'unknown'>();
		for (const req of requests) {
			if (req.status !== 'approved') {
				map.set(req._id, 'none');
			} else if (!req.batch_id) {
				map.set(req._id, 'unknown');
			} else {
				const batch = batchesMap.get(req.batch_id);
				if (!batch) {
					map.set(req._id, 'unknown');
				} else {
					const cov = deriveApprovalCoverage(req, batch);
					map.set(req._id, cov.kind);
				}
			}
		}
		return map;
	});

	const filteredRequests = $derived(
		filterDistributionRequests(requests, search, status, coverage, coverageMap, sort)
	);

	const hasFilters = $derived(
		status !== 'all' || coverage !== 'all' || search.trim().length > 0 || sort !== 'newest'
	);

	function handleOpenDetail(req: DistributionRequest) {
		selectedDetailRequest = req;
		isDetailOpen = true;
	}

	function handleOpenApproval(req: DistributionRequest) {
		approvingRequest = req;
		isApprovalOpen = true;
	}

	function handleApprovalSuccess() {
		isApprovalOpen = false;
		approvingRequest = null;
	}

	function handleOpenReject(req: DistributionRequest) {
		selectedRejectRequest = req;
		isRejectOpen = true;
	}

	function handleRejectSuccess() {
		isRejectOpen = false;
		selectedRejectRequest = null;
	}

	async function handleCancelRequest(req: DistributionRequest) {
		if (cancelMutation.isPending) {
			toast.error('กำลังยกเลิกคำร้อง โปรดรอให้การดำเนินการปัจจุบันเสร็จสิ้น');
			return;
		}
		if (!canCancel) {
			toast.error('คุณไม่มีสิทธิ์ในการยกเลิกคำร้องนี้');
			return;
		}
		if (req.status !== 'pending') {
			toast.error('สามารถยกเลิกได้เฉพาะคำร้องที่อยู่ในสถานะรอดำเนินการเท่านั้น');
			return;
		}

		const user = authStore.user;
		if (!user?.name) {
			toast.error('ไม่พบข้อมูลผู้ใช้งานที่เข้าสู่ระบบ');
			return;
		}
		const shelterCode = getShelterCode();
		if (req.shelter_code !== shelterCode) {
			toast.error('ไม่สามารถยกเลิกคำร้องของศูนย์พักพิงอื่นได้');
			return;
		}

		try {
			await cancelMutation.mutateAsync({
				requestId: req._id,
				ctx: {
					shelterCode,
					createdBy: user.name,
					roles: user.roles
				}
			});
			toast.success('ยกเลิกคำร้องเบิกจ่ายเรียบร้อยแล้ว');
			isDetailOpen = false;
			selectedDetailRequest = null;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการยกเลิกคำร้อง';
			toast.error(message);
		}
	}
</script>

<main class="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
	<header
		class="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="space-y-1">
			<h1 class="text-3xl font-extrabold tracking-tight">จัดการคำร้องเบิกจ่าย</h1>
			<p class="text-sm text-muted-foreground">ติดตามสถานะคำร้องเบิกจ่ายสิ่งของภายในศูนย์พักพิง</p>
		</div>

		{#if canCreateRequest}
			<Button
				type="button"
				class="gap-1.5 self-start sm:self-auto"
				onclick={() => (isCreateOpen = true)}
			>
				<Plus class="h-4 w-4" />
				สร้างคำร้องเบิกจ่าย
			</Button>
		{/if}
	</header>

	{#if canCreateRequest}
		<CreateRequestDialog bind:open={isCreateOpen} />
	{/if}

	<!-- Request Detail Modal -->
	<RequestDetailDialog
		bind:open={isDetailOpen}
		request={selectedDetailRequest}
		{canApprove}
		{canReject}
		{canCancel}
		isCancelling={cancelMutation.isPending}
		onApprove={(req) => {
			isDetailOpen = false;
			handleOpenApproval(req);
		}}
		onReject={(req) => {
			isDetailOpen = false;
			handleOpenReject(req);
		}}
		onCancel={handleCancelRequest}
		onClose={() => {
			selectedDetailRequest = null;
		}}
	/>

	{#if canReject}
		<RejectRequestDialog
			bind:open={isRejectOpen}
			request={selectedRejectRequest}
			onSuccess={handleRejectSuccess}
			onClose={() => {
				selectedRejectRequest = null;
			}}
		/>
	{/if}

	{#if canApprove}
		<ApprovalDialog
			bind:open={isApprovalOpen}
			request={approvingRequest}
			onSuccess={handleApprovalSuccess}
			onClose={() => {
				approvingRequest = null;
			}}
		/>
	{/if}

	{#if requestQuery.isLoading}
		<Card.Root class="border-border/80 shadow-xs">
			<Card.Content
				class="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
			>
				<Loader2 class="h-8 w-8 animate-spin text-primary" />
				<p class="text-sm">กำลังโหลดคำร้องเบิกจ่าย...</p>
			</Card.Content>
		</Card.Root>
	{:else if requestQuery.isError}
		<Card.Root class="border-destructive/30 bg-destructive/5 shadow-xs">
			<Card.Content class="p-6">
				<h2 class="font-semibold text-destructive">ไม่สามารถโหลดคำร้องเบิกจ่ายได้</h2>
				<p class="mt-1 text-sm text-muted-foreground">โปรดลองใหม่อีกครั้งในภายหลัง</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<RequestStatsHeader {requests} />
		<Card.Root class="border-border/80 shadow-xs">
			<Card.Header>
				<Card.Title>รายการคำร้องเบิกจ่าย</Card.Title>
				<Card.Description>ค้นหาและกรองสถานะจากข้อมูลคำร้องจริงของศูนย์พักพิง</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<RequestFilters bind:search bind:status bind:coverage bind:sort />
				{#if requests.length === 0}
					<div
						class="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-muted-foreground"
					>
						<ClipboardList class="h-10 w-10" />
						<div>
							<p class="font-medium text-foreground">ยังไม่มีคำร้องเบิกจ่าย</p>
							<p class="mt-1 text-sm">คำร้องที่สร้างในศูนย์พักพิงจะแสดงที่นี่</p>
						</div>
					</div>
				{:else if filteredRequests.length === 0 && hasFilters}
					<div
						class="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-muted-foreground"
					>
						<SearchX class="h-10 w-10" />
						<div>
							<p class="font-medium text-foreground">ไม่พบคำร้องที่ตรงกับเงื่อนไข</p>
							<p class="mt-1 text-sm">ลองเปลี่ยนคำค้นหาหรือสถานะที่เลือก</p>
						</div>
					</div>
				{:else}
					<RequestTable
						requests={filteredRequests}
						{coverageMap}
						{canApprove}
						{canReject}
						onView={handleOpenDetail}
						onApprove={handleOpenApproval}
						onReject={handleOpenReject}
					/>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</main>
