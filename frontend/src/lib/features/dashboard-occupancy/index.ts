/**
 * Public API barrel for the dashboard-occupancy feature.
 * Only export what other features and routes are allowed to consume.
 */
export type { OccupancyPayload } from './domain/schema';
export { OccupancyPayloadSchema, rowsToOccupancyPayload } from './domain/schema';
export { fetchOccupancy } from './data/occupancy.api';
