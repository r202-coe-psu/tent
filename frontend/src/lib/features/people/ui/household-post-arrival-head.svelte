<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { useSearchEvacuees, zoneLabel } from '../index';
	import type { Evacuee, Household } from '../domain/people';
	import { toast } from 'svelte-sonner';

	// Icons
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import Scan from '@lucide/svelte/icons/scan';
	import Trash from '@lucide/svelte/icons/trash';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Eye from '@lucide/svelte/icons/eye';

	let {
		selectedHead = $bindable(null),
		allHouseholds = [],
		allEvacuees = [],
		onScanClick,
		onCancel,
		onNext,
		onViewProfile
	}: {
		selectedHead: Evacuee | null;
		allHouseholds: Household[];
		allEvacuees: Evacuee[];
		onScanClick: () => void;
		onCancel: () => void;
		onNext: () => void;
		onViewProfile: (id: string) => void;
	} = $props();

	// Search states
	let headQuery = $state('');
	let debouncedHeadQuery = $state('');
	let headDebounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = headQuery.trim();
		clearTimeout(headDebounceTimer);
		if (!q) {
			debouncedHeadQuery = '';
			return;
		}
		headDebounceTimer = setTimeout(() => {
			debouncedHeadQuery = q;
		}, 300);
		return () => clearTimeout(headDebounceTimer);
	});

	const headSearch = useSearchEvacuees(
		() => debouncedHeadQuery,
		() => !!debouncedHeadQuery
	);
	const headSearchResults = $derived(headSearch.data ?? []);
	const isSearchingHead = $derived(headSearch.isFetching && !!debouncedHeadQuery);

	function checkEvacueeHhConflict(evacuee: Evacuee): { conflicted: boolean; label?: string } {
		if (!evacuee.household_id) return { conflicted: false };
		const hh = allHouseholds.find((h) => h._id === evacuee.household_id);
		if (!hh || hh.status === 'cancelled' || hh.status === 'checked_out') {
			return { conflicted: false };
		}
		// If household has other members, it's a real duplicate active household
		const otherMembers = allEvacuees.filter(
			(e) => e.household_id === evacuee.household_id && e._id !== evacuee._id
		);
		if (otherMembers.length > 0) {
			return { conflicted: true, label: hh.label };
		}
		return { conflicted: false };
	}

	function selectHead(evacuee: Evacuee) {
		const conflict = checkEvacueeHhConflict(evacuee);
		if (conflict.conflicted) {
			toast.error(
				`ไม่สามารถกำหนดเป็นหัวหน้าได้ เนื่องจาก ${evacuee.first_name} ${evacuee.last_name} สังกัดครัวเรือน "${conflict.label}" ที่ยังมีสมาชิกอื่นอยู่`
			);
			return;
		}
		selectedHead = evacuee;
	}

	const STATUS_LABELS: Record<string, string> = {
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		active: 'อยู่ในศูนย์',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายศูนย์',
		checked_out: 'ย้ายออก/กลับภูมิลำเนา',
		deceased: 'เสียชีวิต'
	};
</script>

<div class="mx-auto w-full max-w-3xl space-y-6">
	<div class="space-y-2">
		<h3 class="text-lg font-bold text-foreground">1. ตรวจสอบและเลือกหัวหน้าครัวเรือน</h3>
		<p class="text-sm text-muted-foreground">
			สืบค้นข้อมูลผู้ประสบภัยที่ทำการเช็คอินเข้าพักในศูนย์แล้ว เพื่อกำหนดเป็นหัวหน้าครัวเรือนหลัก
		</p>
	</div>

	<!-- Selected Head Info Card -->
	{#if selectedHead}
		<div class="space-y-4 rounded-xl border border-green-200 bg-green-50/50 p-6 shadow-xs">
			<div class="flex items-start justify-between">
				<div>
					<Badge class="mb-2 bg-green-600 text-white">หัวหน้าครัวเรือนที่เลือก</Badge>
					<h4 class="text-lg font-bold text-green-950">
						{selectedHead.first_name}
						{selectedHead.last_name}
					</h4>
					<p class="text-sm text-green-800">
						{#if selectedHead.phone}เบอร์โทร: {selectedHead.phone} ·
						{/if}
						เลขบัตร: {selectedHead.person_id?.number || 'ไม่มีข้อมูล'}
					</p>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => onViewProfile(selectedHead!._id)}>
						<Eye class="mr-1 size-4" /> ดูโปรไฟล์
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="border-destructive text-destructive hover:bg-destructive/10"
						onclick={() => {
							selectedHead = null;
						}}
					>
						<Trash class="mr-1 size-4" /> เปลี่ยนคน
					</Button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Search box -->
		<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
			<div class="flex gap-2">
				<div class="relative flex-1">
					{#if isSearchingHead}
						<Loader
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground"
						/>
					{:else}
						<Search
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground"
						/>
					{/if}
					<Input
						type="text"
						placeholder="เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล..."
						bind:value={headQuery}
						class="h-12 bg-muted/20 pl-10"
					/>
				</div>
				<Button
					type="button"
					variant="outline"
					class="h-12 border-[#003B71] px-4 font-bold text-[#003B71] hover:bg-[#003B71]/10"
					onclick={onScanClick}
				>
					<Scan class="mr-2 size-4" /> สแกน QR
				</Button>
			</div>

			{#if isSearchingHead}
				<div class="flex items-center justify-center py-6 text-sm text-muted-foreground">
					กำลังค้นหาหัวหน้าครัวเรือน...
				</div>
			{:else if debouncedHeadQuery && headSearchResults.length === 0}
				<div class="py-6 text-center text-sm text-muted-foreground">
					ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา
				</div>
			{:else if headSearchResults.length > 0}
				<div class="max-h-[300px] space-y-2 overflow-y-auto">
					{#each headSearchResults as evacuee (evacuee._id)}
						{@const conflict = checkEvacueeHhConflict(evacuee)}
						<div
							class="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/10 p-3"
						>
							<div class="min-w-0">
								<p class="font-semibold text-slate-800">
									{evacuee.first_name}
									{evacuee.last_name}
								</p>
								<p class="text-xs text-muted-foreground">
									สถานะ: {STATUS_LABELS[evacuee.current_stay.status] ?? evacuee.current_stay.status}
									{#if evacuee.phone}
										· {evacuee.phone}{/if}
									{#if evacuee.current_stay.zone}
										· {zoneLabel(evacuee.current_stay.zone)}{/if}
								</p>
							</div>

							<div class="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => onViewProfile(evacuee._id)}
								>
									<Eye class="mr-1 size-4" /> ดูโปรไฟล์
								</Button>
								{#if conflict.conflicted}
									<div class="flex flex-col items-end gap-1">
										<Badge variant="destructive" class="flex items-center gap-1 py-0.5">
											<ShieldAlert class="size-3" />
											สังกัด: {conflict.label}
										</Badge>
									</div>
								{:else}
									<Button type="button" size="sm" onclick={() => selectHead(evacuee)}>
										เลือกเป็นหัวหน้า
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Controls -->
	<div class="flex items-center justify-between border-t border-border pt-6">
		<Button variant="outline" onclick={onCancel}>ยกเลิก</Button>
		<Button disabled={!selectedHead} onclick={onNext} class="bg-[#003B71] hover:bg-[#002a50]">
			ขั้นตอนถัดไป <ArrowRight class="ml-1.5 size-4" />
		</Button>
	</div>
</div>
