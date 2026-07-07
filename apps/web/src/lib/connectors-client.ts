/**
 * Account-scoped Connectors API client.
 */

import { backendApi } from '@/lib/api-client';
import { getSupabaseAccessTokenWithRetry } from '@/lib/auth-token';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSupabaseAccessTokenWithRetry();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export interface UserConnector {
  connectorId: string;
  accountId: string;
  projectId: string | null;
  slug: string;
  name: string;
  providerType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listUserConnectors(): Promise<UserConnector[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/connectors', { headers });
  return res.data?.connectors ?? [];
}

export async function createUserConnector(data: {
  slug: string;
  name: string;
  providerType: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<UserConnector> {
  const headers = await authHeaders();
  const res = await backendApi.post('/connectors', data, { headers });
  return res.data.connector;
}

export async function updateUserConnector(
  id: string,
  data: Partial<Pick<UserConnector, 'name' | 'config' | 'enabled' | 'status'>>,
): Promise<UserConnector> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/connectors/${id}`, data, { headers });
  return res.data.connector;
}

export async function deleteUserConnector(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/connectors/${id}`, { headers });
}

// ─── Pipedream Catalog (3,235+ apps) ─────────────────────────────────────

export interface CatalogApp {
  slug: string;
  name: string;
  description: string | null;
  imgSrc: string | null;
  authType: string | null;
  categories: string[];
}

export interface CatalogAppDetail extends CatalogApp {}

export interface CatalogAction {
  key: string;
  name: string;
  description?: string;
  params: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
}

export interface PipedreamAccount {
  id: string;
  app: string;
  appName: string;
}

export async function listCatalogApps(
  query?: string,
  cursor?: string,
): Promise<{ apps: CatalogApp[]; nextCursor?: string; hasMore: boolean; totalCount: number }> {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  const res = await backendApi.get(`/connectors/catalog${qs ? `?${qs}` : ''}`, { headers });
  return {
    apps: res.data?.apps ?? [],
    nextCursor: res.data?.nextCursor,
    hasMore: res.data?.hasMore ?? false,
    totalCount: res.data?.totalCount ?? 0,
  };
}

export async function getCatalogApp(slug: string): Promise<CatalogAppDetail | null> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/connectors/catalog/${slug}`, { headers });
  return res.data?.app ?? null;
}

export async function listCatalogActions(slug: string): Promise<CatalogAction[]> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/connectors/catalog/${slug}/actions`, { headers });
  return res.data?.actions ?? [];
}

export async function startPipedreamConnect(
  appSlug?: string,
): Promise<{ token: string; connectUrl?: string; expiresAt: string }> {
  const headers = await authHeaders();
  const res = await backendApi.post('/connectors/pipedream/connect', { appSlug }, { headers });
  return res.data;
}

export async function listPipedreamAccounts(): Promise<PipedreamAccount[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/connectors/pipedream/accounts', { headers });
  return res.data?.accounts ?? [];
}

export async function getPipedreamStatus(): Promise<{ configured: boolean }> {
  const headers = await authHeaders();
  const res = await backendApi.get('/connectors/pipedream/status', { headers });
  return res.data;
}

export async function finalizePipedreamConnect(
  appSlug?: string,
): Promise<{ ok: boolean; created: string[]; existing: string[]; total: number }> {
  const headers = await authHeaders();
  const res = await backendApi.post('/connectors/pipedream/finalize', { appSlug }, { headers });
  return res.data;
}
