# VaelorX Mobile App — Migration Plan (Project → Session)

> **الإصدار:** 1.0
> **تاريخ الإنشاء:** 2026-07-12
> **الهدف:** تحويل تطبيق الموبايل من نظام قائم على المشاريع إلى نظام قائم على الجلسات المباشرة

---

## 📊 الحالة الحالية

| المجال | الحالة |
|--------|--------|
| **الإطار** | Expo SDK 54 / React Native 0.81 |
| **البناء** | EAS Build + OTA Updates (expo-updates) |
| **الـ API** | كل البيانات تمر عبر `apps/api` (لا يوجد وصول مباشر لـ DB) |
| **الـ Auth** | Supabase (JWT فقط — لا قراءة/كتابة لجداول DB) |
| **الكود المشترك** | `@kortix/shared` (types + utils) — مشترك مع Web |
| **DB** | `project_id` أصبح nullable بالفعل في كل جداول session |

### المفاهيم الثلاثة المتداخلة في الموبايل

| المفهوم | المكان | الـ Endpoint | الربط |
|---------|--------|-------------|------|
| **Project Sessions** (DB) | `lib/projects/projects-client.ts` | `/projects/{id}/sessions/*` | project_id |
| **OpenCode sessions** (sandbox) | `lib/platform/hooks.ts` | `{sandboxUrl}/session/*` | sandbox only |
| **Legacy threads** (Suna) | `lib/chat/hooks.ts` | `/threads?project_id=…` | project_id (مهمل) |

---

## 🎯 أهداف التحويل

1. **استبدال `/projects/{id}/sessions/*`** بـ `/sessions/*` (مستوى أعلى، بدون project_id)
2. **إزالة `selected-project-store`** — لم يعد هناك حاجة لاختيار مشروع قبل إنشاء جلسة
3. **إضافة صفحة `app/sessions/`** — قائمة جلسات مستقلة بدون مشاريع
4. **تحديث `home.tsx`** — إنشاء/فتح جلسات مباشرة بدون project context
5. **حذف legacy threads** — استبدالها بنظام الجلسات الجديد
6. **الحفاظ على backward compatibility** — `/projects/*` يبقى يعمل للموبايل القديم

---

## 📐 المراحل

### Phase M1 — تحديث الـ API Client Layer (1-2 يوم)

#### M1.1: إنشاء `lib/sessions/sessions-client.ts`
استخراج session endpoints من `projects-client.ts` إلى client مستقل:

```typescript
// lib/sessions/sessions-client.ts

// قائمة الجلسات (بدون project_id)
export async function listSessions(accountId: string): Promise<Session[]>
// GET /v1/sessions?account_id=…

// إنشاء جلسة جديدة
export async function createSession(accountId: string, opts: { name?: string; initial_prompt?: string }): Promise<Session>
// POST /v1/sessions

// بدء/استئناف جلسة
export async function startSession(sessionId: string): Promise<SessionStartResult>
// POST /v1/sessions/{id}/start

// إعادة تشغيل
export async function restartSession(sessionId: string): Promise<void>
// POST /v1/sessions/{id}/restart

// حذف
export async function deleteSession(sessionId: string): Promise<void>
// DELETE /v1/sessions/{id}

// تحديث
export async function updateSession(sessionId: string, updates: { name?: string }): Promise<Session>
// PATCH /v1/sessions/{id}

// مشاركة
export async function setSessionSharing(sessionId: string, sharing: { is_public: boolean }): Promise<void>
// PUT /v1/sessions/{id}/sharing
```

#### M1.2: تحديث `Session` type
```typescript
// lib/sessions/types.ts
export interface Session {
  session_id: string;
  account_id: string;
  project_id: string | null;  // nullable الآن
  status: 'provisioning' | 'running' | 'stopped' | 'failed' | 'completed' | 'deleted' | 'archived';
  sandbox_id: string | null;
  sandbox_url: string | null;
  opencode_session_id: string | null;
  agent_name: string;
  metadata: {
    name?: string;
    source?: string;
    session_mode?: string;
    initial_prompt?: string | null;
  };
  created_at: string;
  updated_at: string;
}
```

#### M1.3: تحديث `lib/platform/client.ts`
- `ensureSandbox()` — إزالة الاعتماد على project selection
- استدعاء `/v1/sessions` بدلاً من `/v1/projects/{id}/sessions`

---

### Phase M2 — تحديث الـ Stores (نصف يوم)

#### M2.1: استبدال `selected-project-store.ts`
```typescript
// stores/session-store.ts (بديل)
// لم يعد هناك "مشروع محدد" — بدلاً من ذلك:
// - آخر جلسة مفتوحة
// - حالة إنشاء جلسة جديدة
```

#### M2.2: تحديث `stores/tab-store.ts` و `message-queue-store.ts`
- هذه بالفعل keyed by `sessionId` فقط — **لا تغيير مطلوب** ✅

---

### Phase M3 — تحديث الـ Hooks (1 يوم)

#### M3.1: إنشاء `hooks/use-sessions.ts`
```typescript
// بديل لـ useProjectSessions
export function useSessions(accountId: string | undefined) {
  // GET /v1/sessions?account_id=…
}

export function useCreateSession() {
  // POST /v1/sessions
}

export function useStartSession() {
  // POST /v1/sessions/{id}/start
}
```

#### M3.2: تحديث `lib/opencode/session-sync.ts`
- إزالة `projectId` من `useSessionSync` params
- الـ sync يعمل بـ `sessionId` + `sandboxUrl` فقط

#### M3.3: تحديث `lib/opencode/hooks/use-project-session-stats.ts`
- إعادة تسمية إلى `use-session-stats.ts`
- إزالة `projectId` param

---

### Phase M4 — تحديث الصفحات (2-3 يوم)

#### M4.1: تحديث `app/home.tsx` (أهم صفحة)
التغييرات:
- إزالة `useProjectSessions` + `useCreateProjectSession`
- استبدالها بـ `useSessions` + `useCreateSession` الجديدة
- إزالة `selected-project-store`
- إنشاء جلسة جديدة مباشرة بدون اختيار مشروع

#### M4.2: إنشاء `app/sessions/index.tsx` + `app/sessions/[id].tsx`
- صفحة قائمة الجلسات (بدون مشاريع)
- صفحة تفاصيل الجلسة (chat view)
- مشابه لـ `apps/web/src/app/(app)/sessions/`

#### M4.3: تحديث `components/session/SessionPage.tsx`
- إزالة `projectId` من props
- استخدام `sessionId` + `sandboxUrl` فقط

#### M4.4: تحديث `components/session/SessionRenameSheet.tsx`
- استدعاء `updateSession(sessionId, {name})` بدلاً من `updateProjectSession(projectId, sessionId, {name})`

#### M4.5: تحديث `components/session/SessionShareSheet.tsx`
- استدعاء `setSessionSharing(sessionId, ...)` بدلاً من `setProjectSessionSharing(projectId, sessionId, ...)`

---

### Phase M5 — تنظيف الـ Legacy (نصف يوم)

#### M5.1: حذف `lib/chat/hooks.ts` (legacy threads)
- استبدال كامل بنظام `/v1/sessions`
- الـ migration endpoint `/legacy/migrate-all` يبقى يعمل

#### M5.2: تحديث `lib/legacy/use-legacy-threads.ts`
- إبقاء migration functionality
- حذف عرض legacy threads في UI

#### M5.3: تحديث `components/menu/LegacyChatsSection.tsx`
- إزالة من القائمة الجانبية أو تحويلها لـ "Import old chats"

---

### Phase M6 — تحديث الـ Types المشتركة (نصف يوم)

#### M6.1: تحديث `lib/agentpress-shared/src/types/sandbox.ts`
```typescript
// project_id يصبح optional
export interface SandboxInfo {
  sandbox_id: string;
  project_id?: string | null;  // كان mandatory
  // ...
}
```

#### M6.2: تحديث `api/types.ts`
- إزالة `ProjectSession` type
- استبداله بـ `Session` type الجديد

---

### Phase M7 — اختبار ونشر (1 يوم)

#### M7.1: اختبار محلي
- `pnpm dev` + اختبار كل الصفحات
- التأكد من إنشاء/فتح/حذف جلسات بدون مشروع
- اختبار الـ SSE streaming
- اختبار الـ file proxy

#### M7.2: اختبار مع API الإنتاج
- توجيه الموبايل لـ `https://kortix-api-vaelorx.bunnyenv.com/v1`
- اختبار كامل مع sandbox حقيقي

#### M7.3: نشر OTA Update
- `eas update --branch production`
- تحديث تلقائي لكل المستخدمين

---

## 📊 ملخص الجهد

| المرحلة | الوصف | الجهد | الملفات المتأثرة |
|---------|-------|-------|-----------------|
| **M1** | API Client Layer | 1-2 يوم | ~5 ملفات جديدة + 3 معدّلة |
| **M2** | Stores | نصف يوم | ~3 ملفات |
| **M3** | Hooks | 1 يوم | ~8 ملفات |
| **M4** | الصفحات | 2-3 يوم | ~15 ملف |
| **M5** | Legacy cleanup | نصف يوم | ~5 ملفات |
| **M6** | Types | نصف يوم | ~3 ملفات |
| **M7** | اختبار + نشر | 1 يوم | — |
| **الإجمالي** | | **6-8 يوم** | **~40 ملف** |

---

## ⚠️ اعتبارات مهمة

1. **Backward Compatibility**: `/v1/projects/*` endpoints تبقى تعمل. الموبايل القديم (قبل OTA update) سيستمر في العمل حتى يتلقى التحديث.

2. **OTA Update**: بما أن التغييرات JS/TS فقط (لا native code)، يمكن نشرها عبر `eas update` بدون مراجعة المتجر.

3. **DB جاهز بالفعل**: `project_id` أصبح nullable في كل الجداول المطلوبة. لا حاجة لـ migration جديد.

4. **الـ API جاهز جزئياً**: `/v1/sessions` routes موجودة بالفعل في `apps/api/src/sessions/routes.ts` وتعمل.

5. **حذف المشاريع من الموبايل**: صفحة `app/projects/` تبقى تعمل (backward compat) لكن تُخفى من الـ navigation.

6. **الـ Web كمرجع**: الـ Web أكمل التحويل بالفعل. الموبايل يتبع نفس النمط.

---

## 🔄 ترتيب التنفيذ

```
M1 (API Client) → M2 (Stores) → M3 (Hooks) → M4 (Pages) → M5 (Legacy) → M6 (Types) → M7 (Test + Deploy)
```

كل مرحلة تُختبر بشكل مستقل قبل الانتقال للمرحلة التالية.

---

**آخر تحديث:** 2026-07-12
