<script lang="ts">
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-0 w-full flex-1 items-stretch overflow-hidden bg-muted/30 text-foreground">
	<div class="min-h-0 w-full flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>
