<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { Referral } from '../domain/referral.schema';
	import type { ReferralBatchFailure } from '../data/referral.repository';
	import { useIntegrationStatus } from '../application/m5-queries';
	import RedactionBanner from './redaction-banner.svelte';
	import EvacueePickerTable from './evacuee-picker-table.svelte';
	import M5ReferralForm from './m5-referral-form.svelte';
	import M5GateAlert from './m5-gate-alert.svelte';

	let {
		onDone
	}: {
		onDone?: (result: { created: Referral[]; failed: ReferralBatchFailure[] }) => void;
	} = $props();

	const statusQuery = useIntegrationStatus();
	const gateState = $derived(statusQuery.data?.m5.state);

	let selectedIds = $state<string[]>([]);
</script>

<!-- OneData M5 create (draft CR M5 D17): medical-emergency + M5 only, no type or mode to pick. -->
<div class="space-y-6">
	<RedactionBanner />

	<Card.Root class="border border-border/80 shadow-md">
		<Card.Header class="rounded-t-xl bg-muted/40 pb-4">
			<Card.Title class="text-xl font-bold">ส่งต่อผู้ป่วยไปโรงพยาบาลผ่าน OneData</Card.Title>
			<Card.Description>
				เลือกผู้ป่วยได้หลายคนเป็น 1 ชุด สธ. พิจารณาทั้งชุด แล้วโรงพยาบาลปลายทางรับเรื่องผ่านระบบ
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6 p-4 md:p-6">
			{#if gateState && gateState !== 'ready'}
				<M5GateAlert
					state={gateState}
					checking={statusQuery.isFetching}
					onRetry={() => statusQuery.refetch()}
				/>
			{/if}

			<EvacueePickerTable bind:selectedIds label="1. เลือกผู้ป่วยที่ต้องการส่งต่อ" />

			<hr class="border-border/60" />

			<M5ReferralForm evacueeIds={selectedIds} {onDone} />
		</Card.Content>
	</Card.Root>
</div>
