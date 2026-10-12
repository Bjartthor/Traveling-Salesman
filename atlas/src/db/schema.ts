import Dexie, { type EntityTable } from 'dexie'
import type {
  City,
  Country,
  Entry,
  LogEntry,
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

    // Photos were removed from the app. `null` tells Dexie to delete both
    // stores on upgrade — reclaiming the device storage their blobs held.
    // Deliberately local only: any photo files already uploaded to Drive are
    // left untouched (nothing reads them any more). Every other table is
    // inherited unchanged from version 2.
    this.version(3).stores({
      photos: null,
      photoBlobs: null,
    })
  }
}

export const db = new AtlasDB()
