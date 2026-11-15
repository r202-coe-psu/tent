<script lang="ts">
	import { IntegrationGateAlert, type M5State } from '$lib/features/integrations';
	import { M5_GATE_MESSAGES } from './referral.m5.ui';

	let {
		state,
		checking = false,
		onRetry
	}: {
		state: Exclude<M5State, 'ready'>;
		checking?: boolean;
		onRetry: () => void;
	} = $props();

	const description =
		'ส่งเข้า OneData ไม่ได้ในตอนนี้ บันทึกร่างไว้ก่อนได้ หรือประสานโรงพยาบาลเองแล้วบันทึกติดตามที่เมนู "การส่งต่อผู้เข้าพัก"';
</script>

<IntegrationGateAlert title={M5_GATE_MESSAGES[state]} {description} {checking} {onRetry} />
