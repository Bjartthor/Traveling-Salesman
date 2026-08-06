import Dexie, { type EntityTable } from 'dexie'
import type {
  City,
  Country,
  Entry,
  LogEntry,
  Photo,
  PhotoBlob,
  Settings,
  Subdivision,
  SyncState,
  Trip,
  TripEntry,
} from '@/db/types'

export class AtlasDB extends Dexie {
  countries!: EntityTable<Country, 'code'>
  subdivisions!: EntityTable<Subdivision, 'id'>
  cities!: EntityTable<City, 'geonameId'>

  entries!: EntityTable<Entry, 'id'>
  trips!: EntityTable<Trip, 'id'>
  tripEntries!: EntityTable<TripEntry, 'id'>
  photos!: EntityTable<Photo, 'id'>
  photoBlobs!: EntityTable<PhotoBlob, 'photoId'>

  settings!: EntityTable<Settings, 'id'>
  syncState!: EntityTable<SyncState, 'id'>

  // Device-only breadcrumb trail (@/debug/log) — never synced, not user data.
  debugLog!: EntityTable<LogEntry, 'id'>

  constructor() {
    super('atlas')

    this.version(1).stores({
      countries: 'code, code3, continent, region',
      subdivisions: 'id, countryCode, name',
      cities: 'geonameId, countryCode, subdivisionId, asciiName, *searchTokens',

      entries: 'id, &[kind+refId], status, updatedAt',
      trips: 'id, isActive, updatedAt',
      tripEntries: 'id, tripId, entryId, updatedAt',
      photos: 'id, entryId, tripId, uploadState, updatedAt',
      photoBlobs: 'photoId',

      settings: 'id',
      syncState: 'id',
    })

    // Additive only — every table from version 1 restated unchanged, plus the
    // new debugLog store. Dexie diffs against the prior version and only
    // creates what's new, so this upgrades an existing device's database (real
    // trips/places already on it) in place without touching any of it.
    this.version(2).stores({
      countries: 'code, code3, continent, region',
      subdivisions: 'id, countryCode, name',
      cities: 'geonameId, countryCode, subdivisionId, asciiName, *searchTokens',

      entries: 'id, &[kind+refId], status, updatedAt',
      trips: 'id, isActive, updatedAt',
      tripEntries: 'id, tripId, entryId, updatedAt',
      photos: 'id, entryId, tripId, uploadState, updatedAt',
      photoBlobs: 'photoId',

      settings: 'id',
      syncState: 'id',

      debugLog: '++id, ts',
    })
  }
}

export const db = new AtlasDB()
