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
