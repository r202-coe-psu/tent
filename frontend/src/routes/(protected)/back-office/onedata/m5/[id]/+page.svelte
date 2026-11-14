<script lang="ts">
	// OneData M5 batch (D17): same view, under the OneData menu so the header and sidebar match.
	import { page } from '$app/state';
	import { ReferralBatchView } from '$lib/features/referrals';
</script>

<ReferralBatchView id={page.params.id ?? ''} />
