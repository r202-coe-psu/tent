<script lang="ts">
	import type { Evacuee } from '../domain/people';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';

	let {
		evacuee,
		onBack
	}: {
		evacuee: Evacuee;
		onBack: () => void;
	} = $props();
</script>

<EvacueeQrModal
	show={true}
	{evacuee}
	embedded={true}
	closeLabel="ย้อนกลับ / ลงทะเบียนคนใหม่"
	onClose={onBack}
/>
