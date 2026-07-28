# Edge Case Hunter Review

Invoke the `bmad-review-edge-case-hunter` skill and exhaustively review the following implementation diff without assuming prior conversation context. Walk every state transition and input boundary. Report only unhandled edge cases, with file/line references, consequence, and a suggested fix.

## Diff

```diff
diff --git a/frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte b/frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte
@@
 	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
+	const clampedPage = $derived(Math.min(currentPage, totalPages));
 	const pageShelters = $derived(
-		shelters.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
+		shelters.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
 	);
@@
-					<Pagination.Root bind:page={currentPage} count={total} perPage={PAGE_SIZE}>
+					<Pagination.Root
+						bind:page={() => clampedPage, (p) => (currentPage = p)}
+						count={total}
+						perPage={PAGE_SIZE}
+					>
@@
-									<Pagination.Link page={p} isActive={p.value === currentPage} />
+									<Pagination.Link page={p} isActive={p.value === clampedPage} />

diff --git a/frontend/src/routes/api/back-office/master-data/[type]/+server.ts b/frontend/src/routes/api/back-office/master-data/[type]/+server.ts
@@
-	const queryCode = url.searchParams.get('shelter_code') || undefined;
+	const queryCode = url.searchParams.get('shelter_code')?.trim() || undefined;

diff --git a/frontend/src/routes/api/back-office/master-data/[type]/server.test.ts b/frontend/src/routes/api/back-office/master-data/[type]/server.test.ts
@@
+	it('trims shelter_code query parameters before resolving scope', async () => {
+		readMock.mockResolvedValue(null);
+		const res = await callGET('pet_types', '?scope=shelter&shelter_code=%20SH001%20');
+		expect(res.status).toBe(200);
+		expect(authMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
+		expect(readMock).toHaveBeenCalledWith('pet_types', 'SH001');
+	});
```
