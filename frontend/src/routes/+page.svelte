<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-2 text-3xl font-bold">CouchDB Lab</h1>
	<p class="text-muted-foreground mb-6">SvelteKit SPA + PouchDB live-sync + CouchDB demo</p>
	<Button href={resolve('/login')}>Login</Button>
</div>
