import { TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY } from "../shared/constants";

export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
  const token = result[TOKEN_STORAGE_KEY];
  const expiry = result[TOKEN_EXPIRY_KEY];

  if (!token || !expiry) return null;

  const expiryMs = new Date(expiry).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) {
    await clearToken();
    return null;
  }

  return token;
}

export async function setToken(token: string, expiresAt: string): Promise<void> {
  await chrome.storage.local.set({
    [TOKEN_STORAGE_KEY]: token,
    [TOKEN_EXPIRY_KEY]: expiresAt,
  });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
}

export async function isTokenValid(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
