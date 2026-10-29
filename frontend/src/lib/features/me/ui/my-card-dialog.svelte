<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { StaffCardView, staffCardRoleLabel } from '$lib/features/users';
	import type { MyCardNoneReason } from '../domain/my-card';
	import { useMyCard } from '../application/queries';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	let {
		open = $bindable(false),
		shelterCode,
		shelterName
	}: {
		open?: boolean;
		shelterCode: string | null;
		shelterName: string | null;
	} = $props();

	const cardQuery = useMyCard(() => open);

	const noneMessages: Record<MyCardNoneReason, string> = {
		no_token: 'ยังไม่มี QR กรุณาติดต่อผู้ดูแลระบบเพื่อออกบัตร',
		volunteer_unlinked: 'บัญชีนี้ยังไม่ผูกกับข้อมูลจิตอาสา กรุณาติดต่อผู้ดูแล',
		inactive: 'บัญชีถูกปิดใช้งาน'
	};

	const card = $derived(cardQuery.data);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[460px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-slate-900">บัตรของฉัน</Dialog.Title>
			<Dialog.Description class="pt-1 text-sm text-slate-600">
				บัตรนี้ใช้ได้กับทุกศูนย์ ใช้สแกนยืนยันตัวตน
			</Dialog.Description>
		</Dialog.Header>

		{#if cardQuery.isFetching}
			<p class="py-8 text-center text-sm text-slate-500" role="status">กำลังโหลดบัตร...</p>
		{:else if cardQuery.isError}
			<div class="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
				<p class="text-sm text-red-900">ไม่สามารถโหลดบัตรได้ กรุณาลองใหม่อีกครั้ง</p>
				<Button
					variant="outline"
					class="min-h-11 w-full gap-1.5 sm:w-auto"
					onclick={() => cardQuery.refetch()}
				>
					<RefreshCw class="size-4" aria-hidden="true" /> ลองใหม่
				</Button>
			</div>
		{:else if card?.kind === 'staff'}
			<StaffCardView
				payload={card.payload}
				displayName={card.display_name}
				roleLabel={staffCardRoleLabel(card.roles, shelterCode)}
				position={card.position}
				{shelterName}
			/>
		{:else if card?.kind === 'volunteer'}
			<StaffCardView
				payload={card.payload}
				displayName={card.display_name}
				roleLabel="จิตอาสา"
				volunteerCode={card.volunteer_code}
				{shelterName}
			/>
		{:else if card?.kind === 'none'}
			<p class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
				{noneMessages[card.reason]}
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
