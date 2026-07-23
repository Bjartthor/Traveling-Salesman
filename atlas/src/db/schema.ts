import Dexie, { type EntityTable } from 'dexie'
import type {
  City,
  Country,
  Entry,
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
  }
}

export const db = new AtlasDB()
