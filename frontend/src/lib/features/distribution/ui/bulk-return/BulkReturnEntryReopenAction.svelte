<script lang="ts">
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { REOPEN_LOAN_ACTION, REOPEN_LOAN_RESUME_ACTION } from '../model/bulk-return-pool-v3';

	interface Props {
		/** The loans of this entry can be reopened: offer the button. */
		showButton: boolean;
		/** A reopen doc already exists: label the button as a resume (no new reason is asked). */
		resume?: boolean;
		/** Disables the button while a resume is in flight. */
		pending?: boolean;
		/** Why the button is withheld (some applied loan was closed); shown when there is no button. */
		blockedNotice: string | null;
		onReopen: () => void;
	}

	let { showButton, resume = false, pending = false, blockedNotice, onReopen }: Props = $props();
</script>

{#if showButton}
	<div class="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			onclick={onReopen}
			class="min-h-11 w-full gap-2 border-red-200 text-red-800 hover:bg-red-50 sm:w-auto"
		>
			<Undo2 class="h-4 w-4" aria-hidden="true" />
			{resume ? REOPEN_LOAN_RESUME_ACTION : REOPEN_LOAN_ACTION}
		</Button>
	</div>
{:else if blockedNotice}
	<p
		data-testid="bulk-return-reopen-blocked"
		class="pt-1 text-xs font-medium text-amber-800 sm:text-right"
	>
		{blockedNotice}
	</p>
{/if}
