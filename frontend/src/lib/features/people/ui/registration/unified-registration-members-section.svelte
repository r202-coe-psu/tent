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
		pending = false,
		mode = 'create',
		channel = 'onsite',
		memberPhotoUpload = 'none',
		shelterCode = '',
		membersSectionDesc,
		isJoiningExistingHousehold = false,
		primaryContactPhone = null,
		thaidEnabled = false,
		existingMembers = [],
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
		/** Joining a family: its current members, shown read-only before the new cards. */
		existingMembers?: readonly Evacuee[];
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
		if (name) return name;
		if (index === 0 && !isJoiningExistingHousehold) return t.primaryContact;
		return `${t.memberLabel} ${existingMembers.length + index + 1}`;
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
		toast.success(`ดึงข้อมูล ${profile.first_name} ${profile.last_name} เรียบร้อยแล้ว`);
	}
</script>

<UnifiedRegistrationSection
	id="unified-members"
	title={t.sectionMembers}
	description={membersSectionDesc}
	badge={`${existingMembers.length + members.length}${t.memberCountUnit ? ` ${t.memberCountUnit}` : ''}`}
	icon={Users}
	bodyClass="none"
>
	{#if existingMembers.length > 0}
		<section
			aria-labelledby="existing-members-title"
			class="mb-4 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3"
		>
			<h3 id="existing-members-title" class="text-sm font-semibold text-foreground">
				สมาชิกเดิมในครอบครัว ({existingMembers.length} คน) · ดูอย่างเดียว
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
								? 'ชาย'
								: existing.gender === 'female'
									? 'หญิง'
									: 'ไม่ระบุเพศ'}
							{#if age != null}· อายุ {age} ปี{/if}
							{#if (existing.vulnerable_groups?.length ?? 0) > 0}
								· กลุ่มเปราะบาง {existing.vulnerable_groups.length}
							{/if}
						</p>
					</li>
				{/each}
			</ul>
			<p class="text-2xs text-muted-foreground">
				แก้ไขข้อมูลสมาชิกเดิมได้ที่หน้าโปรไฟล์ — กรอกเฉพาะคนที่มาใหม่ด้านล่าง
			</p>
		</section>
		<h3 class="mb-2 text-sm font-semibold text-foreground">สมาชิกที่มาใหม่</h3>
	{/if}

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
					{isJoiningExistingHousehold}
					numberOffset={existingMembers.length}
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
				<span>เพิ่มสมาชิกด้วย ThaiD (สแกน QR)</span>
			</Button>
		{/if}
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			onclick={addMember}
			class="h-11 w-full gap-1.5 border-dashed text-sm sm:w-auto"
		>
			<Plus class="size-4" />
			{t.addMember}
		</Button>
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
