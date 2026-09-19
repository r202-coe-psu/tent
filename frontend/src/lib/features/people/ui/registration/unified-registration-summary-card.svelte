<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Home from '@lucide/svelte/icons/home';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Package from '@lucide/svelte/icons/package';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import type {
		UnifiedMemberWithMeta,
		UnifiedRegistrationInput
	} from '../../domain/unified-registration';

	let {
		shelterName = '',
		shelterCode = '',
		household,
		members,
		showVehiclesAssets = false,
		activeSection,
		pending = false,
		submitDisabled = false,
		submitLabel = 'ยืนยันการลงทะเบียน',
		submittingLabel = 'กำลังบันทึก...',
		onNavigate
	}: {
		shelterName?: string;
		shelterCode?: string;
		household: UnifiedRegistrationInput['household'];
		members: UnifiedMemberWithMeta[];
		showVehiclesAssets?: boolean;
		activeSection: string;
		pending?: boolean;
		submitDisabled?: boolean;
		submitLabel?: string;
		submittingLabel?: string;
		onNavigate: (sectionId: string) => void;
	} = $props();

	const formattedAddress = $derived.by(() => {
		const parts = [
			household.address_no ? `บ้านเลขที่ ${household.address_no}` : '',
			household.village_no ? `หมู่ ${household.village_no}` : '',
			household.subdistrict ? `ต.${household.subdistrict}` : '',
			household.district ? `อ.${household.district}` : '',
			household.province ? `จ.${household.province}` : '',
			household.postal_code || ''
		].filter(Boolean);
		return parts.join(' ');
	});

	const headMember = $derived(members[0]);
	const headFullName = $derived(
		headMember ? `${headMember.first_name || ''} ${headMember.last_name || ''}`.trim() : ''
	);

	const petCount = $derived(
		(household.pets ?? []).reduce((sum: number, p) => sum + (Number(p.count) || 1), 0)
	);

	const maleCount = $derived(members.filter((m) => m.gender === 'male').length);
	const femaleCount = $derived(members.filter((m) => m.gender === 'female').length);
	const vulnerableCount = $derived(
		members.filter(
			(m) => (m.vulnerable_groups?.length ?? 0) > 0 || (m.special_needs?.length ?? 0) > 0
		).length
	);

	const isAddressReady = $derived(
		Boolean(
			household.province?.trim() && household.district?.trim() && household.subdistrict?.trim()
		)
	);
	const isMembersReady = $derived(Boolean(headMember?.first_name?.trim()));
</script>

<div
	class="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs transition-shadow"
>
	<!-- Header -->
	<div class="border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
		<div class="flex items-center justify-between gap-2">
			<span class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
				สรุปข้อมูลการลงทะเบียน
			</span>
			<span
				class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-semibold text-primary"
			>
				Live Summary
			</span>
		</div>
	</div>

	<div class="space-y-4 p-4 sm:p-5">
		<!-- 1. Shelter Info -->
		<div class="space-y-1 rounded-xl border border-border/50 bg-muted/10 p-3">
			<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
				<Building2 class="size-3.5 text-primary" />
				<span>ศูนย์พักพิงเป้าหมาย</span>
			</div>
			{#if shelterName}
				<p class="text-sm font-bold text-foreground">{shelterName}</p>
			{:else if shelterCode}
				<p class="text-sm font-bold text-foreground">ศูนย์พักพิงรหัส {shelterCode}</p>
			{:else}
				<p class="text-sm font-bold text-foreground">📍 ไม่ระบุศูนย์พักพิง</p>
				<p class="text-2xs text-muted-foreground">ลงทะเบียนเข้าคิวกลางเพื่อรอจัดสรร</p>
			{/if}
		</div>

		<!-- 2. Address & Residence Info -->
		<div class="space-y-1.5 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<Home class="size-3.5 text-primary" />
					<span>ที่พักอาศัย / ที่อยู่เดิม</span>
				</span>
				<button
					type="button"
					onclick={() => onNavigate('address')}
					class="text-2xs font-medium text-primary hover:underline"
				>
					แก้ไข
				</button>
			</div>
			{#if formattedAddress}
				<p class="text-xs leading-relaxed font-medium text-foreground">
					{formattedAddress}
				</p>
			{:else}
				<p class="text-xs text-muted-foreground italic">ยังไม่ได้ระบุที่อยู่</p>
			{/if}
			{#if household.residence_landmark}
				<p class="truncate text-2xs text-muted-foreground">
					จุดสังเกต: {household.residence_landmark}
				</p>
			{/if}
		</div>

		<!-- 3. Members Info -->
		<div class="space-y-2 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<Users class="size-3.5 text-primary" />
					<span>สมาชิกครอบครัว</span>
				</span>
				<span
					class="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-bold text-primary tabular-nums"
				>
					{members.length} คน
				</span>
			</div>

			<div class="text-xs text-foreground">
				<span class="text-muted-foreground">ผู้ติดต่อหลัก: </span>
				<span class="font-semibold">{headFullName || 'ยังไม่ได้ระบุชื่อ'}</span>
			</div>

			<div class="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
				{#if maleCount > 0}
					<span class="rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
						ชาย {maleCount}
					</span>
				{/if}
				{#if femaleCount > 0}
					<span class="rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
						หญิง {femaleCount}
					</span>
				{/if}
				{#if vulnerableCount > 0}
					<span
						class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
					>
						<ShieldAlert class="size-3" />
						กลุ่มดูแลพิเศษ {vulnerableCount} คน
					</span>
				{/if}
			</div>
		</div>

		<!-- 4. Pets & Assets Info -->
		<div class="space-y-1.5 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<PawPrint class="size-3.5 text-primary" />
					<span>สัตว์เลี้ยง</span>
				</span>
				<span class="text-xs font-medium text-foreground">
					{petCount > 0 ? `${petCount} ตัว` : 'ไม่มี'}
				</span>
			</div>

			{#if showVehiclesAssets}
				<div class="flex items-center justify-between gap-2 pt-1">
					<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
						<Package class="size-3.5 text-primary" />
						<span>ยานพาหนะ</span>
					</span>
					<span class="text-xs font-medium text-foreground">
						{(household.vehicles ?? []).length > 0
							? `${(household.vehicles ?? []).length} คัน`
							: 'ไม่มี'}
					</span>
				</div>
			{/if}
		</div>

		<!-- 5. Quick Jump Nav -->
		<div class="space-y-1.5">
			<span class="text-3xs font-semibold text-muted-foreground uppercase">
				ทางลัดไปยังแต่ละส่วน
			</span>
			<div class="grid grid-cols-2 gap-1.5 text-xs">
				<button
					type="button"
					onclick={() => onNavigate('address')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'address'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">1. ที่อยู่</span>
					{#if isAddressReady}
						<Check class="size-3 text-emerald-600" />
					{:else}
						<ChevronRight class="size-3 text-muted-foreground" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => onNavigate('members')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'members'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">2. สมาชิก</span>
					{#if isMembersReady}
						<Check class="size-3 text-emerald-600" />
					{:else}
						<ChevronRight class="size-3 text-muted-foreground" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => onNavigate('pets')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'pets'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">3. สัตว์เลี้ยง</span>
					<ChevronRight class="size-3 text-muted-foreground" />
				</button>
				{#if showVehiclesAssets}
					<button
						type="button"
						onclick={() => onNavigate('vehicles')}
						class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
						'vehicles'
							? 'border-primary/40 font-semibold text-primary'
							: 'text-foreground'}"
					>
						<span class="truncate">4. ยานพาหนะ</span>
						<ChevronRight class="size-3 text-muted-foreground" />
					</button>
				{/if}
			</div>
		</div>

		<!-- 6. Submit Button (Desktop Access) -->
		<div class="pt-2">
			<Button
				type="submit"
				disabled={pending || submitDisabled}
				class="h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-xs"
			>
				{#if pending}
					<Loader2 class="size-4 animate-spin" />
					{submittingLabel}
				{:else}
					{submitLabel}
				{/if}
			</Button>
		</div>
	</div>
</div>
