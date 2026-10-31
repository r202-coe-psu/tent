// Reactive overview rows the mocked `useBulkReturnPoolOverview` serves to the add-entries form.
// Swapping `data` mimics a live `_changes` refetch of the pool overview.
export const overviewMock = $state({
	data: [] as { pool: { _id: string; name: string; status: string; lock: unknown } }[]
});
