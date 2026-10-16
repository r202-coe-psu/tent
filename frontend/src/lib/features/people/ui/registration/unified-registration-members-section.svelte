<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import { tick } from 'svelte';
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
	import {
		evacueeAgeYears,
		formatPersonName,
		STATUS_LABELS,
		type Evacuee
	} from '../../domain/people';
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import ThaidMemberScanDialog from './thaid-member-scan-dialog.svelte';

	let {
		members = $bindable<UnifiedMemberWithMeta[]>(),
		memberFieldErrors = {},
		membersError = null,
		validationSeq = 0,
		firstErrorMember = null,
		pending = false,
		mode = 'create',
		channel = 'onsite',
		memberPhotoUpload = 'none',
		shelterCode = '',
		membersSectionDesc,
		isJoiningExistingHousehold = false,
		existingMemberCount = null,
		primaryContactPhone = null,
		thaidEnabled = false,
		existingMembers = [],
		onDirty
	}: {
		members: UnifiedMemberWithMeta[];
		memberFieldErrors?: Record<number, Record<string, string>>;
		/** Batch-level error (more than 20 members) — shown under the section header. */
		membersError?: string | null;
		/** Bumped on every failed submit so cards can re-open collapsed sections holding an error. */
		validationSeq?: number;
		/** Member card holding the first error of the last failed submit. */
		firstErrorMember?: number | null;
		pending?: boolean;
		mode?: 'create' | 'report-in';
		channel?: UnifiedRegistrationChannel;
		memberPhotoUpload?: MemberPhotoUploadMode;
		shelterCode?: string;
		membersSectionDesc: string;
		isJoiningExistingHousehold?: boolean;
		/** Count of people already in the household being joined (from match chip). */
		existingMemberCount?: number | null;
		primaryContactPhone?: string | null;
		thaidEnabled?: boolean;
		/** Joining a family: its current members, shown read-only before the new cards. */
		existingMembers?: readonly Evacuee[];
		onDirty?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));
	const MEMBERS_ERROR_ID = 'members-limit-error';
	/** Members already in the joined family — new cards are numbered after them. */
	const existingTotal = $derived(existingMembers.length || (existingMemberCount ?? 0));

	const sectionTitle = $derived(
		isJoiningExistingHousehold ? t.sectionMembersJoin : t.sectionMembers
	);
	const sectionDescription = $derived(
		isJoiningExistingHousehold ? t.sectionMembersDescJoin : membersSectionDesc
	);
	const addMemberLabel = $derived(isJoiningExistingHousehold ? t.addMemberJoin : t.addMember);

	// Onsite lists the joined family's members; public only knows how many (from the match chip).
	const knownExistingCount = $derived(existingTotal);

	const membersBadges = $derived.by(() => {
		const unit = t.memberCountUnit ? ` ${t.memberCountUnit}` : '';
		if (isJoiningExistingHousehold) {
			const badges: Array<{ text: string; tone?: 'primary' | 'muted' }> = [];
			if (knownExistingCount > 0) {
				badges.push({
					text: `${t.memberBadgeExisting} ${knownExistingCount}${unit}`,
					tone: 'muted'
				});
			}
			badges.push({
				text: `${t.memberBadgeAddingMore} ${members.length}${unit}`,
				tone: 'primary'
			});
			return badges;
		}
		return [{ text: `${members.length}${unit}`, tone: 'primary' as const }];
	});

	/** Station 1: large families switch member cards via tabs instead of one long scroll. */
	const MEMBER_TABS_MIN = 3;
	const useMemberTabs = $derived(channel === 'onsite' && members.length >= MEMBER_TABS_MIN);

	// Manual tab choice is pinned to the submit it was made after: a new failed submit
	// (new `validationSeq`) jumps to the member with the first error.
	let pickedTab = $state(0);
	let pickedAtSeq = $state(0);
	const activeMemberTab = $derived.by(() => {
		const wanted =
			firstErrorMember !== null && pickedAtSeq !== validationSeq ? firstErrorMember : pickedTab;
		return Math.min(Math.max(wanted, 0), Math.max(members.length - 1, 0));
	});

	function selectMemberTab(index: number) {
		pickedTab = index;
		pickedAtSeq = validationSeq;
	}

	function memberTabLabel(member: UnifiedMemberWithMeta, index: number): string {
		const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
		if (name) return name;
		if (index === 0 && !isJoiningExistingHousehold) return t.primaryContact;
		return `${t.memberNum} ${existingTotal + index + 1}`;
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
		void revealMember(members.length - 1);
	}

	/** Bring the new member's card into view and put the cursor in its first text field. */
	async function revealMember(index: number) {
		await tick();
		const card = document.getElementById(
			useMemberTabs ? `member-panel-${index}` : `member-card-${index}`
		);
		if (!card) return;
		card.scrollIntoView({ behavior: 'smooth', block: 'start' });
		card
			.querySelector<HTMLInputElement>(
				'input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
			)
			?.focus({ preventScroll: true });
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
		toast.success(t.thaidFetchedToast(`${profile.first_name} ${profile.last_name}`));
	}
</script>

<UnifiedRegistrationSection
	id="unified-members"
	title={sectionTitle}
	description={sectionDescription}
	badges={membersBadges}
	icon={Users}
	bodyClass="none"
>
	{#if existingMembers.length > 0}
		<section
			aria-labelledby="existing-members-title"
			class="mb-4 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3"
		>
			<h3 id="existing-members-title" class="text-sm font-semibold text-foreground">
				{t.onsiteExistingMembersTitle(existingMembers.length)}
			</h3>
			<ul class="grid gap-2 sm:grid-cols-2">
				{#each existingMembers as existing, i (existing._id)}
					{@const age = evacueeAgeYears(existing)}
					<li class="rounded-lg border border-border/60 bg-card p-2.5 text-xs">
						<div class="flex items-start justify-between gap-2">
							<p class="font-semibold text-foreground">
								{i + 1}. {formatPersonName(existing)}
								{#if existing.nickname}
									<span class="font-normal text-muted-foreground">({existing.nickname})</span>
								{/if}
							</p>
							<span
								class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground"
							>
								{STATUS_LABELS[existing.current_stay.status] ?? existing.current_stay.status}
							</span>
						</div>
						<p class="mt-1 text-muted-foreground">
							{existing.gender === 'male'
								? t.genderMale
								: existing.gender === 'female'
									? t.genderFemale
									: t.genderUnspecified}
							{#if age != null}· {t.ageYears(age)}{/if}
							{#if (existing.vulnerable_groups?.length ?? 0) > 0}
								· {t.vulnerableCount(existing.vulnerable_groups.length)}
							{/if}
						</p>
					</li>
				{/each}
			</ul>
			<p class="text-2xs text-muted-foreground">
				{t.onsiteExistingMembersHint}
			</p>
		</section>
		<h3 class="mb-2 text-sm font-semibold text-foreground">{t.newMembersTitle}</h3>
	{/if}

	{#if isJoiningExistingHousehold && existingMembers.length === 0 && knownExistingCount > 0}
		<div
			class="mb-3 rounded-xl border border-border/70 bg-muted/30 p-3 sm:p-3.5"
			role="status"
			aria-live="polite"
		>
			<p class="text-sm font-semibold text-foreground">
				{t.existingMembersCount(knownExistingCount)}
			</p>
			<p class="mt-1 text-xs leading-relaxed text-muted-foreground">{t.existingMembersHint}</p>
		</div>
	{/if}

	{#if membersError}
		<p id={MEMBERS_ERROR_ID} class="mb-3 text-sm font-medium text-destructive">{membersError}</p>
	{/if}

	{#if useMemberTabs}
		<div
			role="tablist"
			aria-label={t.memberTabsAria}
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
							>{t.memberHasErrors}</span
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
				id={useMemberTabs ? `member-panel-${index}` : `member-card-${index}`}
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
					{validationSeq}
					{isJoiningExistingHousehold}
					numberOffset={existingTotal}
					primaryContactPhone={isJoiningExistingHousehold
						? primaryContactPhone
						: (members[0]?.phone ?? null)}
					onRemove={() => removeMember(index)}
					onScanThaiD={thaidEnabled ? () => handleOpenScanForMember(index) : undefined}
				/>
			</div>
		{/each}
	</div>

	<!-- Below the last member, so adding the next person never needs a scroll back up -->
	<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
		{#if channel === 'public' && thaidEnabled}
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onclick={handleAddMemberViaThaiD}
				class="h-11 w-full gap-1.5 border-primary/30 text-sm text-primary hover:bg-primary/10 sm:w-auto"
			>
				<QrCodeIcon class="size-4" />
				<span>{t.thaidAddMember}</span>
			</Button>
		{/if}
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			onclick={addMember}
			aria-invalid={membersError ? true : undefined}
			aria-describedby={membersError ? MEMBERS_ERROR_ID : undefined}
			class="h-11 w-full gap-1.5 border-transparent bg-[#0284C7] text-sm font-semibold text-white shadow-2xs hover:bg-[#0369A1] hover:text-white focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:w-auto"
		>
			<Plus class="size-4" />
			{addMemberLabel}
		</Button>
	</div>

	{#if thaidEnabled}
		<ThaidMemberScanDialog
			bind:open={scanDialogOpen}
			memberLabel={targetMemberIndex !== null
				? t.thaidScanMemberN(targetMemberIndex + 1)
				: t.thaidScanFamilyMember}
			onscanned={handleMemberScanned}
		/>
	{/if}
</UnifiedRegistrationSection>
