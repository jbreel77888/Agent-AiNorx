# Phase 7 — الخطة المرجعية الشاملة لإزالة نظام المشاريع

> **الإصدار:** 2.0
> **تاريخ الإنشاء:** 2026-07-12
> **الحالة:** بانتظار الموافقة
> **الفرع:** `feat/session-only-mode`

---

## 📊 نتائج الفحص العميق

### API — الاعتمادات المتقاطعة

| المصدر | المستهلك | عدد الاستيرادات | قابل للحذف؟ |
|--------|---------|----------------|------------|
| `projects/connectors` | executor (7), platform, channels | 7 | ❌ يحتاج نقل |
| `projects/triggers` | executor (4), platform, snapshots | 4 | ❌ يحتاج نقل |
| `projects/secrets` | executor, llm-gateway, setup-links, channels, router | 5 | ❌ يحتاج نقل |
| `projects/git` | executor, platform, snapshots, channels | 4 | ❌ يحتاج نقل |
| `projects/policies` | executor (3) | 3 | ❌ يحتاج نقل |
| `projects/index` (barrel) | executor (3) | 3 | ❌ يحتاج تقسيم |
| `projects/lib/*` | executor, platform, sandbox-proxy, setup-links | 5 | ❌ يحتاج نقل |
| `projects/session-lifecycle` | channels (slack, telegram) | 2 | ❌ يحتاج نقل |
| `projects/opencode-mapping` | sessions/routes.ts | 1 | ❌ يحتاج نقل |
| `projects/sandbox-reaper` | platform/webhooks | 1 | ❌ يحتاج نقل |
| `projects/agents` | platform/session-sandbox | 1 | ❌ يحتاج نقل |
| `projects/starter` | snapshots/build-context | 1 | ❌ يحتاج نقل |
| `projects/maintenance` | index.ts (start/stop) | 1 | ✅ يمكن حذفه |
| `projects/legacy-migration*` | scripts (4 files) | 4 | ✅ يمكن حذفه |
| `projects/suna-migration/*` | scripts, index.ts | 2 | ✅ يمكن حذفه |
| `projects/routes/r1-r10` | index.ts (mount) | 14 | ⚠️ إبقاء كـ deprecated shim |
| `projects/github.ts` | routes/r1 | 1 | ✅ يمكن حذفه |
| `projects/git-backends/*` | git-proxy, routes | 2 | ✅ يمكن حذفه |
| `projects/change-requests.ts` | routes/r9 | 1 | ✅ يمكن حذفه |
| `projects/triggers.ts` | routes/r4, index.ts | 1 | ✅ يمكن حذفه (بعد نقل readManifest) |
| `projects/apps.ts` | routes/r6 | 1 | ✅ يمكن حذفه |
| `projects/apps-config.ts` | routes/r6 | 1 | ✅ يمكن حذفه |
| `projects/app-sweep.ts` | maintenance | 1 | ✅ يمكن حذفه |
| `projects/access.ts` | routes/r1, executor/db-deps | 1 | ❌ يحتاج نقل (loadProjectForUser) |
| `projects/secrets.ts` | متعدد | 5 | ❌ يحتاج نقل |
| `projects/policies.ts` | executor | 3 | ❌ يحتاج نقل |
| `projects/codex-device-auth.ts` | لا أحد | 0 | ✅ يمكن حذفه |
| `projects/legacy-vm-access.ts` | scripts/test-legacy | 1 | ✅ يمكن حذفه |
| `projects/git-proxy/` | لا أحد (standalone) | 0 | ✅ يمكن حذفه |
| `admin/` | لا شيء | 0 | ✅ نظيف |
| `billing/` | لا شيء | 0 | ✅ نظيف |
| `connectors/` | لا شيء | 0 | ✅ نظيف |

### Web — إحصائية الملفات

| الدليل | عدد الملفات | قابل للحذف؟ |
|--------|------------|------------|
| `app/(app)/projects/` | 8 | ✅ (middleware يعيد توجيه لـ /sessions) |
| `features/co-worker/` | 15 | ✅ |
| `features/project-files/` | 59 | ✅ |
| `features/projects/` | 4 | ✅ |
| `hooks/projects/` | 7 | ✅ |
| `components/projects/` | 48 | ⚠️ 3 ملفات تحتاج نقل |
| `stores/project-*` | 3 | ✅ |
| **الإجمالي** | **144** | |

**اعتمادات حرجة في Web:**
- `features/session/` يستورد من `projects-client` (12 استيراد)
- `SessionStartStage` type — مستخدم في 3 ملفات session
- `getProjectSession` — مستخدم في 2 ملف session
- `listProjectSessions`, `restartProjectSession` — مستخدم في session header
- 3 modals في `features/co-worker/project-sidebar/modal/` — مستخدمة في session header

### CLI — إحصائية الملفات

| الملف | الوصف | قابل للحذف؟ |
|------|-------|------------|
| `commands/projects.ts` | إدارة المشاريع | ✅ |
| `commands/ship.ts` | نشر التغييرات | ✅ |
| `commands/cr.ts` | طلبات التغيير | ✅ |
| `commands/connectors.ts` | connectors (project-scoped) | ⚠️ يحتاج تحديث |
| `commands/channels.ts` | channels (project-scoped) | ⚠️ يحتاج تحديث |
| `commands/triggers.ts` | triggers (project-scoped) | ✅ |
| `commands/apps.ts` | apps (project-scoped) | ✅ |
| `commands/sessions.ts` | يستخدم /projects/{id}/sessions | ❌ يحتاج تحديث لـ /sessions |
| `commands/sessions-chat.ts` | يستخدم /projects/{id}/sessions | ❌ يحتاج تحديث |
| `commands/sessions-digest.ts` | يستخدم /projects/{id}/sessions | ❌ يحتاج تحديث |
| `commands/doctor.ts` | يستخدم /projects/{id}/sessions | ❌ يحتاج تحديث |
| `commands/proxy.ts` | يستخدم /projects/{id}/sessions | ❌ يحتاج تحديث |
| `project-link.ts` | ربط .kortix/link.json | ✅ |
| `executor/gateway.ts` | يستخدم /projects/{id}/connect-requests | ⚠️ يحتاج تحديث |

---

## 📐 الخطة التفصيلية

### القاعدة الذهبية: **لا تكسر الإنتاج ولا الموبايل**

1. `/v1/projects/*` routes تبقى تعمل كـ deprecated shim
2. جداول `project_*` DB تبقى موجودة
3. كل نقل كود يتم BEFORE الحذف
4. اختبار build بعد كل خطوة

---

### Phase 7.0 — نقل الكود المشترك (مهمة حرجة) — **2 يوم**

هذه المرحلة يجب أن تتم BEFORE أي حذف. نقل الكود المشترك من `projects/` إلى وحدات مستقلة.

#### 7.0.1: إنشاء `apps/api/src/shared/connectors.ts`

**النقل من:** `projects/connectors.ts`
**الملفات المتأثرة:** executor (7 ملفات), channels, platform

نقل:
- `ConnectorSpec` type
- `ChannelPlatform` type
- `ConnectorProvider` type
- `extractConnectors()` function
- `manifestHashForConnector()` function
- `RESERVED_CONNECTOR_SLUGS` constant
- `SLACK_RESERVED_SLUG` constant
- `connectorSpecToTomlEntry()` function

تحديث الاستيرادات في:
- `executor/materialize.ts`
- `executor/sync.ts`
- `executor/channel-materialize.ts`
- `executor/manifest-crud.ts`
- `executor/channel-rules.ts`
- `executor/normalize.ts`
- `executor/computer-materialize.ts`
- `executor/channel-manifest.ts`

#### 7.0.2: إنشاء `apps/api/src/shared/manifest.ts`

**النقل من:** `projects/triggers.ts`
**الملفات المتأثرة:** executor (4), platform, snapshots, channels

نقل:
- `readManifest()` function
- `MANIFEST_FILENAME` constant
- `KNOWN_SCHEMA_VERSION` constant
- `parseManifestString()` function

تحديث الاستيرادات في:
- `executor/sync.ts`
- `executor/channel-materialize.ts`
- `executor/computer-materialize.ts`
- `platform/services/session-sandbox.ts`
- `snapshots/templates.ts`

#### 7.0.3: إنشاء `apps/api/src/shared/secrets.ts`

**النقل من:** `projects/secrets.ts`
**الملفات المتأثرة:** executor, llm-gateway, setup-links, channels, router

نقل:
- `encryptProjectSecret()` → إعادة تسمية لـ `encryptSecret()`
- `decryptProjectSecret()` → إعادة تسمية لـ `decryptSecret()`
- `getProjectSecretValue()` → إعادة تسمية لـ `getSecretValue()`
- `isValidSecretName()` function
- `writeSharedProjectSecret()` → إعادة تسمية لـ `writeSharedSecret()`

تحديث الاستيرادات في:
- `executor/credentials.ts`
- `llm-gateway/credentials/codex.ts`
- `llm-gateway/resolution/resolve-candidates.ts`
- `setup-links/public-app.ts`
- `setup-links/token.ts`
- `channels/install-store.ts`
- `router/routes/session-llm.ts`

#### 7.0.4: إنشاء `apps/api/src/shared/policies.ts`

**النقل من:** `projects/policies.ts`
**الملفات المتأثرة:** executor (3)

نقل:
- `ProjectPolicySpec` → إعادة تسمية لـ `PolicySpec`
- `extractProjectPolicies()` → إعادة تسمية لـ `extractPolicies()`

تحديث الاستيرادات في:
- `executor/materialize.ts`
- `executor/sync.ts`
- `executor/manifest-crud.ts`

#### 7.0.5: نقل `projects/opencode-mapping.ts` → `sessions/opencode-mapping.ts`

**الملفات المتأثرة:** sessions/routes.ts (1 استيراد)

نقل الملف كاملاً إلى `apps/api/src/sessions/opencode-mapping.ts`
تحديث الاستيراد في `sessions/routes.ts`

#### 7.0.6: نقل `projects/opencode-session-resolver.ts` → `sessions/opencode-session-resolver.ts`

نقل الملف كاملاً
تحديث الاستيرادات في `sessions/opencode-mapping.ts` (المنقول في 7.0.5)

#### 7.0.7: نقل `projects/sandbox-reaper.ts` → `platform/services/sandbox-reaper.ts`

**الملفات المتأثرة:** platform/webhooks/sandbox-webhooks.ts

نقل الملف كاملاً
تحديث الاستيراد في `sandbox-webhooks.ts`

#### 7.0.8: نقل `projects/agents.ts` → `platform/services/agent-grants.ts`

**الملفات المتأثرة:** platform/services/session-sandbox.ts

نقل:
- `resolveAgentGrant()` function
- `extractAgents()` function
- `grantFromLoadedAgents()` function
- `loadProjectAgents()` function

تحديث الاستيراد في `session-sandbox.ts`

#### 7.0.9: نقل `projects/starter.ts` → `packages/starter/src/index.ts` (توسيع)

**الملفات المتأثرة:** snapshots/build-context.ts

نقل:
- `buildStarterFiles()` — موجودة بالفعل في `packages/starter`
- `DEFAULT_STARTER_TEMPLATE_ID` — موجودة بالفعل

تحديث الاستيراد في `snapshots/build-context.ts`

#### 7.0.10: نقل `projects/lib/sessions.ts` → `sessions/session-env.ts`

**الملفات المتأثرة:** platform/services/warm-pool.ts

نقل:
- `buildSpareSandboxEnvVars()` function
- `buildSessionSandboxEnvVars()` function

تحديث الاستيراد في `warm-pool.ts`

#### 7.0.11: نقل `projects/lib/sandbox-env-sync.ts` → `sandbox-proxy/sandbox-env-sync.ts`

**الملفات المتأثرة:** sandbox-proxy/routes/preview.ts, setup-links/public-app.ts

نقل:
- `syncSandboxEnvForPrompt()` function
- `propagateProjectSecretsToActiveSandboxes()` function
- `isReservedSandboxEnvName()` function
- `sanitizeSandboxEnv()` function

تحديث الاستيرادات

#### 7.0.12: نقل `projects/lib/access.ts` → `shared/access.ts`

**الملفات المتأثرة:** executor/db-deps.ts

نقل:
- `loadProjectForUser()` → إعادة تسمية لـ `loadAccountForUser()`
- `isUuid()` function

تحديث الاستيراد في `executor/db-deps.ts`

#### 7.0.13: نقل `projects/lib/git.ts` → `shared/git.ts`

**الملفات المتأثرة:** executor/sync.ts, channels/slack/selection.ts

نقل:
- `withProjectGitAuth()` function
- `resolveCommitSha()` function
- `readRepoFile()` function
- `listRepoFiles()` function
- `loadProjectConfig()` function
- `GitBackedProject` type

تحديث الاستيرادات

#### 7.0.14: نقل `projects/session-lifecycle/` → `sessions/lifecycle/`

**الملفات المتأثرة:** channels/slack/session.ts, channels/telegram-webhook.ts

نقل المجلد كاملاً (7 ملفات):
- `index.ts`
- `types.ts`
- `engine.ts`
- `actor.ts`
- `actions.ts`
- `store.ts`
- `backpressure.ts`

تحديث الاستيرادات في:
- `channels/slack/session.ts`
- `channels/telegram-webhook.ts`
- `apps/api/src/index.ts` (start/stop lifecycle)

#### 7.0.15: تحديث `projects/index.ts` barrel

بعد كل النقل، تحديث `projects/index.ts` لإزالة الـ re-exports المنقولة.
الإبقاء فقط على:
- `projectsApp` (للـ deprecated shim)
- `projectWebhooksApp` (للـ webhooks)
- `loadManifestForEdit` + `commitManifest` (للـ executor) — ستنقل لاحقاً

---

### Phase 7.1 — حذف كود API غير المستخدم — **1 يوم**

بعد اكتمال 7.0، يمكن حذف:

#### ملفات آمنة للحذف (لا يستوردها أحد بعد النقل):

```
apps/api/src/projects/connectors.ts          ← نُقل لـ shared/connectors.ts
apps/api/src/projects/triggers.ts            ← نُقل لـ shared/manifest.ts
apps/api/src/projects/secrets.ts             ← نُقل لـ shared/secrets.ts
apps/api/src/projects/policies.ts            ← نُقل لـ shared/policies.ts
apps/api/src/projects/opencode-mapping.ts    ← نُقل لـ sessions/
apps/api/src/projects/opencode-session-resolver.ts ← نُقل لـ sessions/
apps/api/src/projects/sandbox-reaper.ts      ← نُقل لـ platform/services/
apps/api/src/projects/agents.ts              ← نُقل لـ platform/services/agent-grants.ts
apps/api/src/projects/starter.ts             ← نُقل لـ packages/starter/
apps/api/src/projects/lib/sessions.ts        ← نُقل لـ sessions/session-env.ts
apps/api/src/projects/lib/sandbox-env-sync.ts ← نُقل لـ sandbox-proxy/
apps/api/src/projects/lib/access.ts          ← نُقل لـ shared/access.ts
apps/api/src/projects/lib/git.ts             ← نُقل لـ shared/git.ts
apps/api/src/projects/lib/triggers.ts        ← نُقل لـ shared/manifest.ts (الأجزاء المشتركة)
apps/api/src/projects/session-lifecycle/     ← نُقل لـ sessions/lifecycle/
apps/api/src/projects/github.ts              ← لا يستخدم بعد إزالة routes
apps/api/src/projects/git.ts                 ← نُقل لـ shared/git.ts
apps/api/src/projects/git-backends/          ← لا يستخدم بعد إزالة git-proxy
apps/api/src/projects/git-ref.ts             ← لا يستخدم
apps/api/src/projects/git/                   ← لا يستخدم بعد نقل git.ts
apps/api/src/projects/change-requests.ts     ← لا يستخدم
apps/api/src/projects/triggers.ts            ← لا يستخدم
apps/api/src/projects/apps.ts                ← لا يستخدم
apps/api/src/projects/apps-config.ts         ← لا يستخدم
apps/api/src/projects/app-sweep.ts           ← لا يستخدم
apps/api/src/projects/access.ts              ← نُقل لـ shared/access.ts
apps/api/src/projects/secrets.ts             ← نُقل
apps/api/src/projects/policies.ts            ← نُقل
apps/api/src/projects/codex-device-auth.ts   ← لا يستخدم
apps/api/src/projects/legacy-vm-access.ts    ← لا يستخدم
apps/api/src/projects/legacy-migration*.ts   ← لا يستخدم (8 ملفات)
apps/api/src/projects/suna-migration/        ← لا يستخدم (10 ملفات)
apps/api/src/projects/maintenance.ts         ← لا يستخدم
apps/api/src/git-proxy/                      ← لا يستخدم
```

#### ملفات تبقى (deprecated shims):

```
apps/api/src/projects/index.ts               ← barrel مُحدث (projectsApp فقط)
apps/api/src/projects/lib/app.ts             ← Hono app instance
apps/api/src/projects/lib/serializers.ts     ← session serializers (تبقى للموبايل)
apps/api/src/projects/routes/r1-r10          ← deprecated routes (للموبايل)
apps/api/src/projects/routes/shared.ts       ← session helpers
apps/api/src/projects/routes/setup-links.ts  ← deprecated
apps/api/src/projects/routes/public-shares.ts ← deprecated
apps/api/src/projects/routes/gateway.ts      ← deprecated
apps/api/src/projects/lib/session-runtime-env.ts ← مستخدم بواسطة sessions
apps/api/src/projects/lib/session-status.ts  ← مستخدم
apps/api/src/projects/lib/sandbox-env-names.ts ← مستخدم
apps/api/src/projects/opencode-title-sync.ts ← مستخدم
```

---

### Phase 7.2 — تنظيف Web — **2 يوم**

#### 7.2.1: استخراج الـ types المشتركة من `projects-client.ts`

قبل حذف `projects-client.ts`، استخراج الـ types المستخدمة بواسطة session code:

إنشاء `apps/web/src/lib/session-types.ts`:
```typescript
export type SessionStartStage = 'provisioning' | 'starting' | 'ready' | 'stopped' | 'failed';
export interface SessionStartResult { ... }
// نقل من projects-client.ts
```

تحديث الاستيرادات في:
- `features/session/instant-session-shell.tsx`
- `features/session/session-layout.tsx`
- `features/session/session-starting-loader.tsx`

#### 7.2.2: نقل session modals من `features/co-worker/`

نقل 3 ملفات من `features/co-worker/project-sidebar/modal/` إلى `features/session/modals/`:
- `rename-session-modal.tsx`
- `session-delete-modal.tsx`
- `share-session-modal.tsx`

تحديث الاستيراد في `features/session/header/session-site-header.tsx`

#### 7.2.3: نقل `session-label.ts` من `components/projects/`

نقل `components/projects/session-label.ts` إلى `features/session/session-label.ts`
تحديث الاستيراد في `features/session/header/session-site-header.tsx`

#### 7.2.4: تحديث `session-site-header.tsx`

استبدال:
- `listProjectSessions` → `listSessions` (من sessions-client)
- `restartProjectSession` → `restartSession` (من sessions-client)
- `getProjectSession` → `getSession` (من sessions-client)
- `listProjectSecrets` → إزالة (إخفاء ModelSelector)

#### 7.2.5: تحديث `session-files-panel.tsx` و `session-changes-shared.tsx`

استبدال `getProjectSession` بـ `getSession` من `sessions-client`

#### 7.2.6: تحديث `model-selector.tsx`

إزالة `listProjectSecrets` — ModelSelector سيُخفى بالكامل (Phase 5.2)

#### 7.2.7: حذف الملفات غير المستخدمة

```
apps/web/src/app/(app)/projects/                    (8 ملفات)
apps/web/src/features/co-worker/                    (15 ملف - ما عدا 3 المنقولة)
apps/web/src/features/project-files/                (59 ملف)
apps/web/src/features/projects/                     (4 ملفات)
apps/web/src/hooks/projects/                        (7 ملفات)
apps/web/src/components/projects/                   (48 ملف - ما عدا session-label المنقول)
apps/web/src/stores/project-switch-store.ts
apps/web/src/stores/projects-view-store.ts
apps/web/src/stores/project-session-tabs-store.ts
apps/web/src/stores/apps-overlay-store.ts
apps/web/src/stores/gateway-overlay-store.ts
apps/web/src/stores/customize-store.ts
apps/web/src/lib/customize-sections.ts
apps/web/src/lib/projects-gateway-client.ts
apps/web/src/lib/projects-apps-client.ts
apps/web/src/lib/projects-client.ts                 (بعد استخراج الـ types)
.kortix/
kortix.toml
```

#### 7.2.8: تحديث `feature-flags.ts`

```typescript
export const featureFlags = {
  disableMobileAdvertising: parseEnvBoolean(process.env.NEXT_PUBLIC_DISABLE_MOBILE_ADVERTISING, false),
  enableDinoGame: parseEnvBoolean(process.env.NEXT_PUBLIC_ENABLE_DINO_GAME, false),
  // enableProjects: false — دائماً false (نظام المشاريع أُزيل)
  // isSimpleMode: true — دائماً true
} as const;

// isSimpleMode() دائماً ترجع true
export function isSimpleMode(): boolean { return true; }
```

#### 7.2.9: تحديث `middleware.ts`

إزالة `/projects` من `PROTECTED_ROUTES`
إزالة redirect logic (لم تعد ضرورية — لا يوجد /projects route)

#### 7.2.10: تحديث `components/sidebar/sidebar-left.tsx`

إزالة كل `isSimpleMode` branches — الكود يعمل دائماً في simple mode

#### 7.2.11: تحديث `components/sidebar/session-list.tsx`

إزالة project branches

#### 7.2.12: تحديث `components/command-palette.tsx`

إزالة project commands

---

### Phase 7.3 — تنظيف CLI — **1 يوم**

#### 7.3.1: حذف ملفات الأوامر غير المستخدمة

```
apps/cli/src/commands/projects.ts      ← حذف
apps/cli/src/commands/ship.ts           ← حذف
apps/cli/src/commands/cr.ts             ← حذف
apps/cli/src/commands/triggers.ts       ← حذف
apps/cli/src/commands/apps.ts           ← حذف
apps/cli/src/project-link.ts            ← حذف
```

#### 7.3.2: تحديث `commands/sessions.ts`

تحديث جميع الـ endpoints:
- `/projects/${projectId}/sessions` → `/sessions`
- `/projects/${projectId}/sessions/${sessionId}/start` → `/sessions/${sessionId}/start`
- `/projects/${projectId}/sessions/${sessionId}` → `/sessions/${sessionId}`
- `/projects/${projectId}/sessions/${sessionId}/restart` → `/sessions/${sessionId}/restart`

إزالة `projectId` من جميع الـ function signatures

#### 7.3.3: تحديث `commands/sessions-chat.ts`

نفس التحديثات في 7.3.2

#### 7.3.4: تحديث `commands/sessions-digest.ts`

نفس التحديثات

#### 7.3.5: تحديث `commands/doctor.ts`

تحديث endpoints للـ sessions

#### 7.3.6: تحديث `commands/proxy.ts`

تحديث endpoints

#### 7.3.7: تحديث `executor/gateway.ts`

تحديث:
- `/projects/${projectId}/connect-requests` → `/sessions/${sessionId}/connect-requests`
- `/projects/${projectId}/secret-requests` → `/sessions/${sessionId}/secret-requests`
- `/executor/projects/${projectId}/connectors` → `/executor/sessions/${sessionId}/connectors`

#### 7.3.8: تحديث `web-url.ts`

تحديث:
- `${dashboardUrl}/projects/${projectId}` → `${dashboardUrl}/sessions/${sessionId}`
- `${projectWebUrl}/sessions/${sessionId}` → `${dashboardUrl}/sessions/${sessionId}`

---

### Phase 7.4 — حذف جداول DB — **مؤجل**

⚠️ **لا يتم تنفيذ هذه المرحلة إلا بعد:**
1. اكتمال 7.0 - 7.3
2. تحويل الموبايل بالكامل (M1-M7)
3. تأكيد عدم وجود أي كود يستخدم جداول project_*

#### الجداول الآمنة للحذف:

```sql
-- جداول لا يستخدمها الموبايل ولا الـ API بعد التنظيف
DROP TABLE IF EXISTS kortix.project_git_connections CASCADE;
DROP TABLE IF EXISTS kortix.project_git_credentials CASCADE;
DROP TABLE IF EXISTS kortix.project_members CASCADE;
DROP TABLE IF EXISTS kortix.project_secrets CASCADE;
DROP TABLE IF EXISTS kortix.project_secret_personal_credentials CASCADE;
DROP TABLE IF EXISTS kortix.project_access_requests CASCADE;
DROP TABLE IF EXISTS kortix.project_group_grants CASCADE;
DROP TABLE IF EXISTS kortix.project_trigger_runtime CASCADE;
DROP TABLE IF EXISTS kortix.project_trigger_events CASCADE;
DROP TABLE IF EXISTS kortix.project_apps CASCADE;
DROP TABLE IF EXISTS kortix.project_app_deployments CASCADE;
DROP TABLE IF EXISTS kortix.project_sandbox_pool CASCADE;
DROP TABLE IF EXISTS kortix.change_requests CASCADE;
DROP TABLE IF EXISTS kortix.account_github_installations CASCADE;
DROP TABLE IF EXISTS kortix.account_github_installation_states CASCADE;
DROP TABLE IF EXISTS kortix.legacy_sandbox_migrations CASCADE;
DROP TABLE IF EXISTS kortix.suna_account_migrations CASCADE;
DROP TABLE IF EXISTS kortix.deployments CASCADE;
DROP TABLE IF EXISTS kortix.pipedream_credentials CASCADE;
```

#### الجداول التي تبقى (للموبايل):

```sql
-- تبقى حتى تحويل الموبايل بالكامل
kortix.projects               ← الموبايل يستخدمها
kortix.project_sessions       ← الموبايل يستخدمها
kortix.session_sandboxes      ← مشترك
kortix.project_session_public_shares ← الموبايل
```

---

## 📊 ملخص الجهد

| المرحلة | الوصف | الملفات متأثرة | الجهد |
|---------|-------|---------------|-------|
| **7.0** | نقل الكود المشترك | ~30 ملف جديد + ~40 تحديث استيراد | 2 يوم |
| **7.1** | حذف كود API | ~45 ملف محذوف | 1 يوم |
| **7.2** | تنظيف Web | ~144 ملف محذوف + ~15 معدّل | 2 يوم |
| **7.3** | تنظيف CLI | ~6 محذوف + ~8 معدّل | 1 يوم |
| **7.4** | حذف جداول DB | ~19 جدول محذوف | مؤجل |
| **الإجمالي** | | **~250 ملف** | **6 أيام** |

---

## ⚠️ الترتيب الحرج

```
7.0 (نقل الكود) → 7.1 (حذف API) → 7.2 (تنظيف Web) → 7.3 (تنظيف CLI) → 7.4 (DB — مؤجل)
```

**لا يمكن تخطي 7.0** — بدون نقل الكود المشترك، حذف `projects/` سيكسر executor و platform و channels و sessions.

**لا يمكن تنفيذ 7.4** قبل اكتمال تحويل الموبايل.

---

## 🧪 خطة الاختبار

بعد كل مرحلة:

1. **Build check**: `pnpm build` في root — يجب أن ينجح بدون أخطاء
2. **Type check**: `pnpm typecheck` — يجب أن ينجح
3. **API test**: تشغيل API والتأكد من:
   - `/v1/sessions` يعمل
   - `/v1/projects` (deprecated) لا يزال يعمل
   - `/v1/executor/*` يعمل
   - `/v1/admin/*` يعمل
4. **Web test**: تشغيل Web والتأكد من:
   - `/sessions` يعمل
   - إنشاء/فتح/حذف جلسة يعمل
   - لا أخطاء console
5. **Mobile test**: تشغيل الموبايل والتأكد من:
   - `/sessions` يعمل
   - إنشاء/فتح جلسة يعمل

---

**آخر تحديث:** 2026-07-12 — الخطة جاهزة للموافقة
