import type { PageLoad } from './$types';

/**
 * Deep link from a printed ticket. The phone is still required to see anything,
 * so this only prefills the code — the lookup itself happens on `/register/track`.
 */
export const load: PageLoad = ({ params }) => ({ code: params.code });
