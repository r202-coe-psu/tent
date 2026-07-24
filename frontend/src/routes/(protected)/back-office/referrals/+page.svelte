<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';

	import {
		useReferrals,
		useReferral,
		ReferralCreateForm,
		ReferralList,
		ReferralDetail,
		ReferralBatchCards,
		referralBatchKey,
		type Referral,
		type ReferralBatchFailure,
		type ReferralListGroup
	} from '$lib/features/referrals';

	let viewMode = $state<'list' | 'create' | 'batch'>('list');
	let selectedGroupKey = $state<string | null>(null);
	let selectedMemberId = $state<string | null>(null);
	let selectedGroupReferrals = $state.raw<Referral[]>([]);
	let batchReferrals = $state.raw<Referral[]>([]);
	let batchFailed = $state.raw<ReferralBatchFailure[]>([]);

	const listQuery = useReferrals();
	const referrals = $derived(listQuery.data ?? []);
	const isLoadingList = $derived(listQuery.isLoading);

	const detailQuery = useReferral(
		() => selectedMemberId ?? '',
		() => !!selectedMemberId && viewMode === 'list'
	);
	const selectedReferral = $derived(detailQuery.data);
	const isLoadingDetail = $derived(detailQuery.isFetching);

	/** Keep right-panel batch in sync when list data refreshes. */
	const liveGroupReferrals = $derived.by(() => {
		if (!selectedGroupKey || selectedGroupReferrals.length === 0) return selectedGroupReferrals;
		const fromList = referrals.filter((r) => referralBatchKey(r) === selectedGroupKey);
		return fromList.length > 0 ? fromList : selectedGroupReferrals;
	});

	function handleBatchDone(result: { created: Referral[]; failed: ReferralBatchFailure[] }) {
		batchReferrals = result.created;
		batchFailed = result.failed;
		viewMode = 'batch';
		selectedGroupKey = null;
		selectedMemberId = null;
		selectedGroupReferrals = [];
	}

	function goToList() {
		viewMode = 'list';
		batchReferrals = [];
		batchFailed = [];
		selectedGroupKey = null;
		selectedMemberId = null;
		selectedGroupReferrals = [];
	}

	function goToCreate() {
		viewMode = 'create';
		selectedGroupKey = null;
		selectedMemberId = null;
		selectedGroupReferrals = [];
		batchReferrals = [];
		batchFailed = [];
	}

	function handleSelectGroup(group: ReferralListGroup) {
		selectedGroupKey = group.key;
		selectedGroupReferrals = group.referrals;
		// Single-person "batch" opens detail directly; multi opens batch panel
		selectedMemberId = group.count === 1 ? group.sample._id : null;
	}

	function clearMemberSelection() {
		selectedMemberId = null;
	}

	function clearGroupSelection() {
		selectedGroupKey = null;
		selectedMemberId = null;
		selectedGroupReferrals = [];
	}
</script>

<div class="mx-auto flex h-full min-h-0 max-w-7xl flex-col gap-6 overflow-hidden p-1 md:p-6">
	<div
		class="flex shrink-0 flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
	>
		<div class="space-y-1">
			<h1
				class="bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
			>
				ระบบส่งต่อผู้ประสบภัย
			</h1>
			<p class="text-sm text-muted-foreground">
				สร้างคำขอส่งต่อที่ศูนย์ต้นทาง — คำขอย้ายศูนย์ (capacity) จะปรากฏที่ศูนย์ปลายทางหลังกดส่ง
				และย้ายผู้ประสบภัยเมื่อปลายทางตอบรับเท่านั้น
			</p>
		</div>

		<div>
			{#if viewMode === 'list'}
				<Button onclick={goToCreate} class="gap-2 font-semibold shadow-sm">
					<Plus class="h-4.5 w-4.5" />
					สร้างรายการส่งต่อ
				</Button>
			{:else if viewMode === 'create'}
				<Button variant="outline" onclick={goToList} class="gap-2">
					<ArrowLeft class="h-4.5 w-4.5" />
					กลับไปหน้ารายการ
				</Button>
			{/if}
		</div>
	</div>

	{#if viewMode === 'create'}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="mx-auto w-full max-w-4xl pb-6">
				<ReferralCreateForm onBatchDone={handleBatchDone} />
			</div>
		</div>
	{:else if viewMode === 'batch'}
		<div class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden">
			<ReferralBatchCards referrals={batchReferrals} failed={batchFailed} onBack={goToList} />
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-12 lg:overflow-hidden">
			<div
				class="min-h-0 lg:col-span-5 lg:overflow-y-auto {selectedGroupKey ? 'hidden lg:block' : ''}"
			>
				<Card.Root class="border border-border/80 shadow-sm">
					<Card.Header class="bg-muted/20 pb-3">
						<Card.Title class="text-lg font-bold">รายการส่งตัวทั้งหมด</Card.Title>
						<Card.Description
							>เลือกรายการเพื่อเปิดหน้าดูรายละเอียดและดำเนินการส่งต่อ</Card.Description
						>
					</Card.Header>
					<Card.Content class="px-6 pt-4 pb-4">
						{#if isLoadingList}
							<div
								class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
							>
								<Loader2 class="h-8 w-8 animate-spin text-primary" />
								<span class="text-sm">กำลังโหลดข้อมูล...</span>
							</div>
						{:else}
							<ReferralList
								{referrals}
								onSelect={handleSelectGroup}
								selectedKey={selectedGroupKey}
							/>
						{/if}
					</Card.Content>
				</Card.Root>
			</div>

			<div
				class="flex min-h-0 flex-col lg:col-span-7 lg:overflow-hidden {selectedGroupKey
					? 'min-h-0 flex-1 overflow-hidden'
					: 'hidden lg:flex'}"
			>
				{#if selectedGroupKey}
					{#if selectedMemberId}
						{#if isLoadingDetail && !selectedReferral}
							<Card.Root class="border border-border/80 shadow-sm">
								<Card.Content
									class="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground"
								>
									<Loader2 class="h-8 w-8 animate-spin text-primary" />
									<span class="text-sm font-medium">กำลังเปิดประวัติ...</span>
								</Card.Content>
							</Card.Root>
						{:else if selectedReferral}
							<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
								{#if liveGroupReferrals.length > 1}
									<div class="flex justify-start">
										<Button
											variant="outline"
											size="sm"
											onclick={clearMemberSelection}
											class="gap-2"
										>
											<ArrowLeft class="h-4 w-4" />
											กลับไปชุดส่งต่อ
										</Button>
									</div>
								{:else}
									<div class="flex justify-start lg:hidden">
										<Button variant="outline" size="sm" onclick={clearGroupSelection} class="gap-2">
											<ArrowLeft class="h-4 w-4" />
											กลับไปหน้ารายการ
										</Button>
									</div>
								{/if}
								<ReferralDetail referral={selectedReferral} />
							</div>
						{/if}
					{:else}
						<ReferralBatchCards
							referrals={liveGroupReferrals}
							mode="view"
							selectedId={selectedMemberId}
							onSelectReferral={(id) => (selectedMemberId = id)}
							onBack={clearGroupSelection}
						/>
					{/if}
				{:else}
					<Card.Root
						class="border border-dashed border-border/80 bg-muted/10 p-12 text-center shadow-sm"
					>
						<Card.Content
							class="flex flex-col items-center justify-center py-12 text-muted-foreground"
						>
							<div class="mb-4 rounded-full bg-muted p-4">
								<ClipboardList class="h-10 w-10 text-muted-foreground/80" />
							</div>
							<h3 class="mb-1 text-lg font-bold text-foreground">ยังไม่มีการเลือกรายการ</h3>
							<p class="max-w-sm text-sm">
								กรุณาเลือกรายการส่งตัวจากรายชื่อด้านซ้ายเพื่อเปิดดูรายละเอียดประวัติการส่งตัว
								หรือกดปุ่ม "สร้างรายการส่งต่อ" เพื่อเริ่มร่างบันทึกส่งต่อผู้ประสบภัยรายใหม่
							</p>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		</div>
	{/if}
</div>
