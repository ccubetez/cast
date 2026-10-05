/**
 * authPost: POST с Authorization: Bearer <session token> из store.
 * При 401 сбрасывает verified-флаг — UI предложит пройти VERIFY заново.
 */

'use client';

import { useCastStore } from '@/lib/store';

export async function authPost(path: string, body: unknown): Promise<Response> {
  const token = useCastStore.getState().authToken;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    useCastStore.getState().setWalletState({ walletVerified: false });
  }
  return res;
}
