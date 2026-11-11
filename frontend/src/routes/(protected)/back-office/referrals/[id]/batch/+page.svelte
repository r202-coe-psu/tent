<script lang="ts">
	import { page } from '$app/state';
	import { ReferralBatchView } from '$lib/features/referrals';
</script>

<ReferralBatchView id={page.params.id ?? ''} />
