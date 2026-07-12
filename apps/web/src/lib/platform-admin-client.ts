/**
 * Platform Admin API client — agents, skills, models, plans, providers, settings.
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlatformAgent {
  agentId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  mode: string;
  permission: Record<string, unknown> | null;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSkill {
  skillId: string;
  slug: string;
  name: string;
  description: string | null;
  skillContent: string;
  scripts: Record<string, string> | null;
  referencesData: unknown[] | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformModel {
  modelId: string;
  modelKey: string;
  displayName: string;
  provider: string;
  upstreamModelId: string | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformPlan {
  planId: string;
  slug: string;
  name: string;
  priceMonthlyUsd: number;
  description: string | null;
  features: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformProvider {
  providerId: string;
  providerKey: string;
  displayName: string;
  apiKeyEnc: string | null;
  baseUrl: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSetting {
  key: string;
  value: unknown;
  category: string | null;
  description: string | null;
  updatedAt: string;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export async function listAgents(): Promise<PlatformAgent[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/agents', { headers });
  return res.data?.agents ?? [];
}

export async function createAgent(data: Partial<PlatformAgent>): Promise<PlatformAgent> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/agents', data, { headers });
  return res.data.agent;
}

export async function updateAgent(id: string, data: Partial<PlatformAgent>): Promise<PlatformAgent> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/admin/platform/agents/${id}`, data, { headers });
  return res.data.agent;
}

export async function deleteAgent(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/admin/platform/agents/${id}`, { headers });
}

export async function setDefaultAgent(id: string): Promise<PlatformAgent> {
  const headers = await authHeaders();
  const res = await backendApi.post(`/admin/platform/agents/${id}/default`, {}, { headers });
  return res.data.agent;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export async function listSkills(): Promise<PlatformSkill[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/skills', { headers });
  return res.data?.skills ?? [];
}

export async function createSkill(data: Partial<PlatformSkill>): Promise<PlatformSkill> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/skills', data, { headers });
  return res.data.skill;
}

export async function updateSkill(id: string, data: Partial<PlatformSkill>): Promise<PlatformSkill> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/admin/platform/skills/${id}`, data, { headers });
  return res.data.skill;
}

export async function deleteSkill(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/admin/platform/skills/${id}`, { headers });
}

// ─── Models ──────────────────────────────────────────────────────────────────

export async function listModels(): Promise<PlatformModel[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/models', { headers });
  return res.data?.models ?? [];
}

export async function createModel(data: Partial<PlatformModel>): Promise<PlatformModel> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/models', data, { headers });
  return res.data.model;
}

export async function updateModel(id: string, data: Partial<PlatformModel>): Promise<PlatformModel> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/admin/platform/models/${id}`, data, { headers });
  return res.data.model;
}

export async function deleteModel(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/admin/platform/models/${id}`, { headers });
}

export async function setDefaultModel(id: string): Promise<PlatformModel> {
  const headers = await authHeaders();
  const res = await backendApi.post(`/admin/platform/models/${id}/default`, {}, { headers });
  return res.data.model;
}

// ─── Subscription Plans ──────────────────────────────────────────────────────

export async function listPlans(): Promise<PlatformPlan[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/billing/plans', { headers });
  return res.data?.plans ?? [];
}

export async function createPlan(data: Partial<PlatformPlan>): Promise<PlatformPlan> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/billing/plans', data, { headers });
  return res.data.plan;
}

export async function updatePlan(id: string, data: Partial<PlatformPlan>): Promise<PlatformPlan> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/admin/platform/billing/plans/${id}`, data, { headers });
  return res.data.plan;
}

export async function deletePlan(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/admin/platform/billing/plans/${id}`, { headers });
}

// ─── Providers ───────────────────────────────────────────────────────────────

export async function listProviders(): Promise<PlatformProvider[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/providers', { headers });
  return res.data?.providers ?? [];
}

export async function createProvider(data: Partial<PlatformProvider>): Promise<PlatformProvider> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/providers', data, { headers });
  return res.data.provider;
}

export async function updateProvider(id: string, data: Partial<PlatformProvider>): Promise<PlatformProvider> {
  const headers = await authHeaders();
  const res = await backendApi.patch(`/admin/platform/providers/${id}`, data, { headers });
  return res.data.provider;
}

export async function deleteProvider(id: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/admin/platform/providers/${id}`, { headers });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function listSettings(): Promise<PlatformSetting[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/settings', { headers });
  return res.data?.settings ?? [];
}

export async function updateSettings(updates: Array<{ key: string; value: unknown }>): Promise<PlatformSetting[]> {
  const headers = await authHeaders();
  const res = await backendApi.patch('/admin/platform/settings', { settings: updates }, { headers });
  return res.data.settings;
}

// ─── Publish ─────────────────────────────────────────────────────────────────

export async function publishPlatform(): Promise<{
  ok: boolean;
  version: string;
  published: {
    sandboxesTotal: number;
    sandboxesUpdated: number;
    sandboxesFailed: number;
    errors: string[];
  };
}> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/publish', {}, { headers });
  return res.data;
}

export async function getPublishStatus(): Promise<{
  version: string;
  activeAgents: number;
  activeSkills: number;
  activeSandboxes: number;
}> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/publish/status', { headers });
  return res.data;
}

// ─── Provider Catalog + Test + Import ────────────────────────────────────────

export interface ProviderCatalogEntry {
  displayName: string;
  baseUrl: string;
  docs: string;
}

export async function getProviderCatalog(): Promise<Record<string, ProviderCatalogEntry>> {
  const headers = await authHeaders();
  const res = await backendApi.get('/admin/platform/provider-catalog', { headers });
  return res.data?.providers ?? {};
}

export async function testProviderConnection(providerKey: string, apiKey: string, baseUrl?: string): Promise<{
  ok: boolean;
  provider?: string;
  modelsCount?: number;
  models?: Array<{ id: string; name: string }>;
  error?: string;
  status?: number;
}> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/providers/test', {
    providerKey, apiKey, baseUrl,
  }, { headers, showErrors: false });
  return res.data;
}

export async function importModels(models: Array<{ id: string; name: string }>, providerKey: string): Promise<{
  ok: boolean;
  imported: number;
  skipped: number;
  total: number;
}> {
  const headers = await authHeaders();
  const res = await backendApi.post('/admin/platform/providers/import-models', {
    models, providerKey,
  }, { headers });
  return res.data;
}
