<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import {
		blankUnifiedMember,
		type MemberPhotoUploadMode,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel
	} from '../../domain/unified-registration';
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import ThaidMemberScanDialog from './thaid-member-scan-dialog.svelte';

	let {
		members = $bindable<UnifiedMemberWithMeta[]>(),
		memberFieldErrors = {},
		pending = false,
		mode = 'create',
		channel = 'onsite',
		memberPhotoUpload = 'none',
		shelterCode = '',
		membersSectionDesc,
		isJoiningExistingHousehold = false,
		primaryContactPhone = null,
		thaidEnabled = false,
		onDirty
	}: {
		members: UnifiedMemberWithMeta[];
		memberFieldErrors?: Record<number, Record<string, string>>;
		pending?: boolean;
		mode?: 'create' | 'report-in';
		channel?: UnifiedRegistrationChannel;
		memberPhotoUpload?: MemberPhotoUploadMode;
		shelterCode?: string;
		membersSectionDesc: string;
		isJoiningExistingHousehold?: boolean;
		primaryContactPhone?: string | null;
		thaidEnabled?: boolean;
		onDirty?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	/** Station 1: large families switch member cards via tabs instead of one long scroll. */
	const MEMBER_TABS_MIN = 3;
	const useMemberTabs = $derived(channel === 'onsite' && members.length >= MEMBER_TABS_MIN);

	const firstErrorIndex = $derived.by((): number | null => {
		const withErrors = Object.entries(memberFieldErrors)
			.filter(([, errs]) => Object.values(errs ?? {}).some(Boolean))
			.map(([i]) => Number(i))
			.sort((a, b) => a - b);
		return withErrors[0] ?? null;
	});

	// Manual tab choice is pinned to the error set it was made against: a new failed submit
	// (new memberFieldErrors object) jumps to the first member with errors.
	let pickedTab = $state(0);
	let pickedForErrors = $state<object | null>(null);
	const activeMemberTab = $derived.by(() => {
		const wanted =
			firstErrorIndex !== null && pickedForErrors !== memberFieldErrors
				? firstErrorIndex
				: pickedTab;
		return Math.min(Math.max(wanted, 0), Math.max(members.length - 1, 0));
	});

	function selectMemberTab(index: number) {
		pickedTab = index;
		pickedForErrors = memberFieldErrors;
	}

	function memberTabLabel(member: UnifiedMemberWithMeta, index: number): string {
		const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
		return name || (index === 0 ? t.primaryContact : `${t.memberNum} ${index + 1}`);
	}

	function hasMemberErrors(index: number): boolean {
		return Object.values(memberFieldErrors[index] ?? {}).some(Boolean);
	}

	function addMember() {
		if (pending) return;
		const newMember: UnifiedMemberWithMeta = {
			...blankUnifiedMember(),
			reporting_in: true
		};
		members = [...members, newMember];
		selectMemberTab(members.length - 1);
		onDirty?.();
	}

	function removeMember(index: number) {
		if (pending) return;
		if (mode === 'report-in') {
			if (members[index]?._id) return;
		} else {
			if (index === 0 || members.length <= 1) return;
		}
		members = members.filter((_, i) => i !== index);
		onDirty?.();
	}

	let scanDialogOpen = $state(false);
	let targetMemberIndex = $state<number | null>(null);

	function handleAddMemberViaThaiD() {
		if (pending) return;
		const newMember: UnifiedMemberWithMeta = {
			...blankUnifiedMember(),
			reporting_in: true
		};
		members = [...members, newMember];
		targetMemberIndex = members.length - 1;
		scanDialogOpen = true;
		onDirty?.();
	}

	function handleOpenScanForMember(index: number) {
		if (pending) return;
		targetMemberIndex = index;
		scanDialogOpen = true;
	}

	function handleMemberScanned(profile: ThaiDAutofillProfile) {
		if (targetMemberIndex === null || !members[targetMemberIndex]) return;
		const m = members[targetMemberIndex];
		m.first_name = profile.first_name;
		m.last_name = profile.last_name;
		if (profile.nickname) m.nickname = profile.nickname;
		m.gender = profile.gender;
		m.birth_year = profile.birth_year;
		m.age = profile.age;
		if (profile.phone) m.phone = profile.phone;
		m.person_id = { cardType: 'national_id', number: profile.person_id };
		m.vulnerable_groups = profile.vulnerable_groups ?? [];
		m.special_needs = profile.special_needs ?? [];
		m.medical_conditions = profile.medical_conditions ?? [];
		members = [...members];
		onDirty?.();
		toast.success(`ดึงข้อมูล ${profile.first_name} ${profile.last_name} เรียบร้อยแล้ว`);
	}
</script>

<UnifiedRegistrationSection
	id="unified-members"
	title={t.sectionMembers}
	description={membersSectionDesc}
	badge={`${members.length}${t.memberCountUnit ? ` ${t.memberCountUnit}` : ''}`}
	icon={Users}
	bodyClass="none"
>
	{#snippet actions()}
		<div class="flex flex-wrap items-center gap-2">
			{#if channel === 'public' && thaidEnabled}
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onclick={handleAddMemberViaThaiD}
					class="h-9 gap-1.5 border-primary/30 text-xs text-primary hover:bg-primary/10 sm:text-sm"
				>
					<QrCodeIcon class="size-4" />
					<span>เพิ่มสมาชิกด้วย ThaiD (สแกน QR)</span>
				</Button>
			{/if}
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onclick={addMember}
				class="h-9 gap-1.5 text-xs sm:text-sm"
			>
				<Plus class="size-4" />
				{t.addMember}
			</Button>
		</div>
	{/snippet}

	{#if useMemberTabs}
		<div
			role="tablist"
			aria-label="สลับสมาชิกครอบครัว"
			class="mb-4 flex gap-1.5 overflow-x-auto border-b border-slate-200 pb-2"
		>
			{#each members as member, index (member._id ?? index)}
				{@const selected = index === activeMemberTab}
				<button
					type="button"
					role="tab"
					id="member-tab-{index}"
					aria-selected={selected}
					aria-controls="member-panel-{index}"
					onclick={() => selectMemberTab(index)}
					class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {selected
						? 'border-[#0A2647] bg-[#0A2647] text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"
				>
					<span class="tabular-nums">{index + 1}.</span>
					<span class="max-w-40 truncate">{memberTabLabel(member, index)}</span>
					{#if hasMemberErrors(index)}
						<span
							class="rounded-full border border-red-200 bg-red-50 px-1.5 text-xs font-semibold text-red-900"
							>มีข้อผิดพลาด</span
						>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<div class="space-y-4">
		{#each [...members.keys()] as index (index)}
			<!-- Hidden (not unmounted) so every card keeps its state while switching tabs -->
			<div
				id={useMemberTabs ? `member-panel-${index}` : undefined}
				role={useMemberTabs ? 'tabpanel' : undefined}
				aria-labelledby={useMemberTabs ? `member-tab-${index}` : undefined}
				class={useMemberTabs && index !== activeMemberTab ? 'hidden' : undefined}
			>
				<UnifiedRegistrationMemberCard
					bind:member={
						() => members[index]!,
						(v) => {
							members[index] = v;
							members = [...members];
						}
					}
					{index}
					canRemove={mode === 'report-in' ? !members[index]?._id : index > 0}
					{mode}
					onReportingInChange={(reportingIn) => {
						if (members[index]) {
							members[index].reporting_in = reportingIn;
							members = [...members];
							onDirty?.();
						}
					}}
					disabled={pending}
					photoUpload={memberPhotoUpload}
					shelterCode={shelterCode.trim()}
					{channel}
					excludeIds={members.map((m) => m._id).filter((id): id is string => Boolean(id))}
					fieldErrors={memberFieldErrors[index]}
					{isJoiningExistingHousehold}
					primaryContactPhone={isJoiningExistingHousehold
						? primaryContactPhone
						: (members[0]?.phone ?? null)}
					onRemove={() => removeMember(index)}
					onScanThaiD={thaidEnabled ? () => handleOpenScanForMember(index) : undefined}
				/>
			</div>
		{/each}
	</div>

	{#if thaidEnabled}
		<ThaidMemberScanDialog
			bind:open={scanDialogOpen}
			memberLabel={targetMemberIndex !== null
				? `สมาชิกคนที่ ${targetMemberIndex + 1}`
				: 'สมาชิกในครอบครัว'}
			onscanned={handleMemberScanned}
		/>
	{/if}
</UnifiedRegistrationSection>
