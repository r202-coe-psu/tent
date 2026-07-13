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
		ReferralDetail
	} from '$lib/features/referrals';

	let viewMode = $state<'list' | 'create'>('list');
	let selectedId = $state<string | null>(null);

	// Queries
	const listQuery = useReferrals();
	const referrals = $derived(listQuery.data ?? []);
	const isLoadingList = $derived(listQuery.isLoading);

	const detailQuery = useReferral(
		() => selectedId ?? '',
		() => !!selectedId
	);
	const selectedReferral = $derived(detailQuery.data);
	const isLoadingDetail = $derived(detailQuery.isFetching);

	function handleCreated(newId: string) {
		viewMode = 'list';
		selectedId = newId;
	}
</script>

<div class="mx-auto flex h-full max-w-7xl flex-col space-y-6 p-1 md:p-6">
	<!-- Page Header -->
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
	>
		<div class="space-y-1">
			<h1
				class="bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
			>
				ระบบส่งต่อผู้ลี้ภัย (Referral System)
			</h1>
			<p class="text-sm text-muted-foreground">
				จัดการคัดกรอง ยื่นเรื่องส่งต่อ
				และอัปเดตสถานะการส่งตัวผู้ลี้ภัยไปยังสถานพยาบาลหรือสังคมสงเคราะห์ภายนอก
			</p>
		</div>

		<div>
			{#if viewMode === 'list'}
				<Button onclick={() => (viewMode = 'create')} class="gap-2 font-semibold shadow-sm">
					<Plus class="h-4.5 w-4.5" />
					สร้างรายการส่งต่อ
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (viewMode = 'list')} class="gap-2">
					<ArrowLeft class="h-4.5 w-4.5" />
					กลับไปหน้ารายการ
				</Button>
			{/if}
		</div>
	</div>

	<!-- Main Workspace Area -->
	{#if viewMode === 'create'}
		<div class="mx-auto w-full max-w-4xl">
			<ReferralCreateForm onCreated={handleCreated} />
		</div>
	{:else}
		<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
			<!-- Left List Column (col-span-5) -->
			<div class="space-y-4 lg:col-span-5">
				<Card.Root class="border border-border/80 shadow-sm">
					<Card.Header class="bg-muted/20 pb-3">
						<Card.Title class="text-lg font-bold">รายการส่งตัวทั้งหมด</Card.Title>
						<Card.Description
							>เลือกรายการเพื่อเปิดหน้าดูรายละเอียดและดำเนินการส่งต่อ</Card.Description
						>
					</Card.Header>
					<Card.Content class="max-h-[70vh] overflow-y-auto pt-4">
						{#if isLoadingList}
							<div
								class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
							>
								<Loader2 class="h-8 w-8 animate-spin text-primary" />
								<span class="text-sm">กำลังโหลดข้อมูล...</span>
							</div>
						{:else}
							<ReferralList {referrals} onSelect={(id) => (selectedId = id)} {selectedId} />
						{/if}
					</Card.Content>
				</Card.Root>
			</div>

			<!-- Right Detail Column (col-span-7) -->
			<div class="space-y-4 lg:col-span-7">
				{#if selectedId}
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
						<ReferralDetail referral={selectedReferral} />
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
								หรือกดปุ่ม "สร้างรายการส่งต่อ" เพื่อเริ่มร่างบันทึกส่งต่อผู้ลี้ภัยรายใหม่
							</p>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		</div>
	{/if}
</div>
