<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { checkEvacueeHouseholdConflict, useSearchEvacuees } from '../index';
	import type { Evacuee, Household } from '../domain/people';
	import { toast } from 'svelte-sonner';

	// Icons
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import Scan from '@lucide/svelte/icons/scan';
	import Trash from '@lucide/svelte/icons/trash';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Users from '@lucide/svelte/icons/users';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Eye from '@lucide/svelte/icons/eye';

	let {
		selectedHead,
		selectedMembers = $bindable([]),
		allHouseholds = [],
		allEvacuees = [],
		onScanClick,
		onBack,
		onNext,
		onViewProfile
	}: {
		selectedHead: Evacuee | null;
		selectedMembers: Evacuee[];
		allHouseholds: Household[];
		allEvacuees: Evacuee[];
		onScanClick: () => void;
		onBack: () => void;
		onNext: () => void;
		onViewProfile: (id: string) => void;
	} = $props();

	// Search states
	let memberQuery = $state('');
	let debouncedMemberQuery = $state('');
	let memberDebounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = memberQuery.trim();
		clearTimeout(memberDebounceTimer);
		if (!q) {
			debouncedMemberQuery = '';
			return;
		}
		memberDebounceTimer = setTimeout(() => {
			debouncedMemberQuery = q;
		}, 300);
		return () => clearTimeout(memberDebounceTimer);
	});

	const memberSearch = useSearchEvacuees(
		() => debouncedMemberQuery,
		() => !!debouncedMemberQuery
	);
	const memberSearchResults = $derived(
		(memberSearch.data ?? []).filter((e) => e._id !== selectedHead?._id)
	);
	const isSearchingMember = $derived(memberSearch.isFetching && !!debouncedMemberQuery);

	function addMember(evacuee: Evacuee) {
		const conflict = checkEvacueeHouseholdConflict(
			evacuee,
			'household:new',
			allHouseholds,
			allEvacuees
		);
		if (conflict.conflicted) {
			toast.error(
				`ไม่สามารถเพิ่มสมาชิกได้ เนื่องจาก ${evacuee.first_name} ${evacuee.last_name} สังกัดครัวเรือน "${conflict.label}" ที่ยังมีสมาชิกอื่นอยู่`
			);
			return;
		}
		if (selectedMembers.some((m) => m._id === evacuee._id)) {
			toast.error('ผู้ประสบภัยรายนี้ถูกเพิ่มเข้าครัวเรือนเรียบร้อยแล้ว');
			return;
		}
		selectedMembers = [...selectedMembers, evacuee];
		toast.success(`เพิ่ม ${evacuee.first_name} เข้าสมาชิกแล้ว`);
	}

	function removeMember(id: string) {
		if (selectedHead?._id === id) {
			toast.error('ไม่สามารถลบหัวหน้าครัวเรือนจากรายชื่อสมาชิกได้');
			return;
		}
		selectedMembers = selectedMembers.filter((m) => m._id !== id);
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

<div class="mx-auto w-full max-w-4xl space-y-6">
	<div class="space-y-2">
		<h3 class="text-lg font-bold text-foreground">2. ค้นหาและเลือกสมาชิกในครัวเรือน</h3>
		<p class="text-sm text-muted-foreground">
			ค้นหาผู้ประสบภัยคนอื่นๆ ที่เข้าพักแล้ว เพื่อเพิ่มเข้ากลุ่มครอบครัวนี้
			(หัวหน้าครอบครัวจะถูกนำมารวมโดยอัตโนมัติ)
		</p>
	</div>

	<div class="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
		<!-- Left Column: Search & Add -->
		<div class="space-y-4 md:col-span-2">
			<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
				<Label class="text-sm font-bold text-slate-800">พิมพ์ชื่อหรือรายละเอียดเพื่อค้นหา</Label>
				<div class="flex gap-2">
					<div class="relative flex-1">
						{#if isSearchingMember}
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
							bind:value={memberQuery}
							class="h-10 pl-10"
						/>
					</div>
					<Button
						type="button"
						variant="outline"
						class="h-10 border-[#003B71] px-3 text-xs font-bold text-[#003B71] hover:bg-[#003B71]/10"
						onclick={onScanClick}
					>
						<Scan class="mr-1.5 size-4" /> สแกน QR
					</Button>
				</div>

				{#if isSearchingMember}
					<div class="py-4 text-center text-xs text-muted-foreground">กำลังค้นหาสมาชิก...</div>
				{:else if debouncedMemberQuery && memberSearchResults.length === 0}
					<div class="py-4 text-center text-xs text-muted-foreground">
						ไม่พบข้อมูลที่ตรงกับการค้นหา
					</div>
				{:else if memberSearchResults.length > 0}
					<div class="max-h-[350px] space-y-2 overflow-y-auto pr-1">
						{#each memberSearchResults as evacuee (evacuee._id)}
							{@const conflict = checkEvacueeHouseholdConflict(
								evacuee,
								'household:new',
								allHouseholds,
								allEvacuees
							)}
							<div
								class="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/5 p-2.5 text-sm"
							>
								<div class="min-w-0">
									<p class="font-semibold text-slate-800">
										{evacuee.first_name}
										{evacuee.last_name}
									</p>
									<p class="text-[11px] text-muted-foreground">
										สถานะ: {STATUS_LABELS[evacuee.current_stay.status] ??
											evacuee.current_stay.status}
										{#if evacuee.phone}
											· {evacuee.phone}{/if}
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
										<Badge variant="destructive" class="flex items-center gap-1 py-0.5 text-[10px]">
											<ShieldAlert class="size-3" />
											สังกัด: {conflict.label}
										</Badge>
									{:else}
										<Button
											type="button"
											variant="outline"
											size="sm"
											onclick={() => addMember(evacuee)}
											disabled={selectedMembers.some((m) => m._id === evacuee._id)}
										>
											{selectedMembers.some((m) => m._id === evacuee._id)
												? 'เพิ่มแล้ว ✓'
												: 'เพิ่มสมาชิก'}
										</Button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Right Column: Selected Members List -->
		<div class="space-y-4">
			<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
				<h4 class="flex items-center gap-1.5 text-sm font-bold text-slate-800">
					<Users class="size-4 text-primary" />
					รายชื่อในครอบครัว ({selectedMembers.length} คน)
				</h4>

				<div class="max-h-[400px] space-y-2 overflow-y-auto">
					{#each selectedMembers as evac (evac._id)}
						<div class="flex items-center justify-between border-b border-border/60 pb-2 text-sm">
							<div class="min-w-0 pr-2">
								<p class="truncate font-medium text-slate-900">
									{evac.first_name}
									{evac.last_name}
								</p>
								<p class="text-xs text-muted-foreground">
									{#if selectedHead?._id === evac._id}
										<Badge class="bg-green-600 px-1.5 py-0 text-[10px] text-white">หัวหน้า</Badge>
									{:else}
										สมาชิก
									{/if}
								</p>
							</div>
							<div class="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-8 px-2 text-xs font-semibold text-primary hover:bg-primary/10"
									onclick={() => onViewProfile(evac._id)}
								>
									<Eye class="mr-1 size-3.5" /> ดูโปรไฟล์
								</Button>
								{#if selectedHead?._id !== evac._id}
									<Button
										variant="ghost"
										size="sm"
										class="h-8 w-8 shrink-0 p-0 text-destructive hover:bg-destructive/10"
										onclick={() => removeMember(evac._id)}
									>
										<Trash class="size-4" />
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Controls -->
	<div class="flex items-center justify-between border-t border-border pt-6">
		<Button variant="outline" onclick={onBack}>ย้อนกลับ</Button>
		<Button
			disabled={selectedMembers.length === 0}
			onclick={onNext}
			class="bg-[#003B71] hover:bg-[#002a50]"
		>
			ขั้นตอนถัดไป <ArrowRight class="ml-1.5 size-4" />
		</Button>
	</div>
</div>
