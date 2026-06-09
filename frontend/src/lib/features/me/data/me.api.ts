import { getSession } from '$lib/db/couch';

export const fetchMe = () => getSession();
