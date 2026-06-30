/**
 * Public API barrel for the dashboard-demographics feature.
 */
export type { DemographicsPayload, AgeGroups, CountryBreakdown } from './domain/schema';
export { DemographicsPayloadSchema, AGE_BUCKETS, rowsToAgeGroups, rowsToCountries } from './domain/schema';
export { fetchDemographics } from './data/demographics.api';
