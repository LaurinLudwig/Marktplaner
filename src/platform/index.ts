import { browserPlatform } from './browser';
import { tauriPlatform } from './tauri';
import type { Platform } from './types';

export type { AutosaveInfo, AutosaveSlot, PickedFile, Platform, SavedFile } from './types';

/** Tauri stellt `__TAURI_INTERNALS__` bereit; sonst läuft die App in einem normalen Browser. */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const platform: Platform = isTauri() ? tauriPlatform : browserPlatform;
