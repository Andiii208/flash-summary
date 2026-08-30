/**
 * Electron-side wiring for the session store: a Cryptor backed by
 * safeStorage (DPAPI on Windows) and convenience load/save helpers.
 * This module is only imported from the Electron main process.
 */
import { safeStorage } from 'electron'
import type { Cryptor } from './session-crypto'

export const dpapiCryptor: Cryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plain) => safeStorage.encryptString(plain),
  decryptString: (buf) => safeStorage.decryptString(buf)
}
