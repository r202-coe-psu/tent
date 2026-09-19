<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
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
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';

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
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			onclick={addMember}
			class="h-9 gap-1.5"
		>
			<Plus class="size-4" />
			{t.addMember}
		</Button>
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
				onApplyZoneToAll={applyZoneToAll}
				onRemove={() => removeMember(index)}
			/>
		{/each}
	</div>
</UnifiedRegistrationSection>
