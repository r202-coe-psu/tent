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
		onDirty?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	function addMember() {
		if (pending) return;
		const newMember: UnifiedMemberWithMeta = {
			...blankUnifiedMember(),
			reporting_in: true
		};
		members = [...members, newMember];
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

	function applyZoneToAll(zoneCode: string) {
		for (const m of members) {
			m.zone = zoneCode;
		}
		members = [...members];
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
			{#if channel === 'public'}
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onclick={handleAddMemberViaThaiD}
					class="h-9 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 text-xs sm:text-sm"
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

	<div class="space-y-4">
		{#each [...members.keys()] as index (index)}
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
				isJoiningExistingHousehold={isJoiningExistingHousehold && index > 0}
				primaryContactPhone={members[0]?.phone}
				onApplyZoneToAll={applyZoneToAll}
				onRemove={() => removeMember(index)}
				onScanThaiD={() => handleOpenScanForMember(index)}
			/>
		{/each}
	</div>

	<ThaidMemberScanDialog
		bind:open={scanDialogOpen}
		memberLabel={targetMemberIndex !== null ? `สมาชิกคนที่ ${targetMemberIndex + 1}` : 'สมาชิกในครอบครัว'}
		onscanned={handleMemberScanned}
	/>
</UnifiedRegistrationSection>
