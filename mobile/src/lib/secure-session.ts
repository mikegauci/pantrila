import "react-native-get-random-values"

import AsyncStorage from "@react-native-async-storage/async-storage"
import * as aesjs from "aes-js"
import * as SecureStore from "expo-secure-store"

/**
 * Session storage for Supabase, as Supabase's Expo guide does it: the Keychain / Keystore
 * (expo-secure-store) holds only a random AES key per item, since it caps values at about 2 KB,
 * and the session itself is stored encrypted in AsyncStorage. Do not change the key scheme
 * without a migration: changing it signs everyone out.
 */
export class LargeSecureStore {
  private async encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8))
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1))
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value))
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey))
    return aesjs.utils.hex.fromBytes(encrypted)
  }

  private async decrypt(key: string, value: string) {
    const encryptionKeyHex = await SecureStore.getItemAsync(key)
    if (!encryptionKeyHex) return encryptionKeyHex
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1))
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)))
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key)
    if (!encrypted) return encrypted
    return this.decrypt(key, encrypted)
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key)
    await SecureStore.deleteItemAsync(key)
  }

  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await this.encrypt(key, value))
  }
}
