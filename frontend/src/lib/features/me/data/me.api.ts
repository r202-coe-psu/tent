import { getSession } from '$lib/db/couch';
import { serviceFetch } from '$lib/api/service';
import type { MyCard } from '../domain/my-card';

export const fetchMe = () => getSession();

export const fetchMyCard = () => serviceFetch<MyCard>('/api/v1/me/card');
