/**
 * Client-safe pure entry for the people feature: constants with no I/O, no Svelte and no
 * import of another feature's barrel.
 *
 * For UI the people barrel cannot be imported into without a cycle — the shelters UI, since
 * people UI imports `$lib/features/shelters`. Server code keeps using `./server`.
 */
export { STATUS_LABELS } from './domain/people';
