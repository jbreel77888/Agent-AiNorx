# Phase 7 — الخطة المرجعية المحدّثة لإزالة نظام المشاريع

> **الإصدار:** 3.0 (محدّث بعد فحص فعلي للكود)
> **تاريخ التحديث:** 2026-07-21
> **الفرع:** `feat/session-only-mode`
> **الحالة:** ~65% منجز — 35% متبقٍ

---

## 📊 نتائج الفحص الفعلي (يوليو 2026)

### API — الوضع الحقيقي

**`shared/index.ts`** يعمل كـ **transitional barrel** — يُعيد تصدير (re-export) من `projects/` بدلاً من نسخ الكود. هذا يعني أن **كل ملفات `projects/` لا تزال موجودة كـ source code حقيقي** (وليست stubs)، و `shared/index.ts` يوجه الاستيرادات إليها.

**153 ملف** في الـ API يستورد من `shared/` (الذي بدوره يستورد من `projects/`).

#### ملفات `projects/` المتبقية (50 ملف):

| الملف | السطور | النوع | قابل للحذف؟ |
|---|---|---|---|
| `connectors.ts` | 497 | كود حقيقي | ❌ يحتاج نقل |
| `triggers.ts` | 421 | كود حقيقي | ❌ يحتاج نقل |
| `secrets.ts` | 247 | كود حقيقي | ❌ يحتاج نقل |
| `policies.ts` | 26 | **re-export stub** | ✅ يمكن حذفه (نُقل لـ shared/policies.ts) |
| `starter.ts` | 13 | **re-export stub** | ✅ يمكن حذفه (يُعيد تصدير من @kortix/starter) |
| `git.ts` | 80 | **re-export barrel** | ❌ يحتاج نقل (يُصدر من git/) |
| `git/` (7 ملفات) | 1641 | كود حقيقي | ❌ يحتاج نقل |
| `git-backends/` (6 ملفات) | 463 | كود حقيقي | ✅ يمكن حذفه (لا مستوردين) |
| `github.ts` | 525 | كود حقيقي | ✅ يمكن حذفه (لا مستوردين) |
| `git-ref.ts` | 26 | كود حقيقي | ✅ يمكن حذفه (لا مستوردين) |
| `access.ts` | 115 | كود حقيقي | ✅ يمكن حذفه (لا مستوردين) |
| `agents.ts` | 327 | كود حقيقي | ❌ يحتاج نقل |
| `apps-config.ts` | 16 | كود حقيقي | ✅ يمكن حذفه (لا مستوردين) |
| `opencode-mapping.ts` | 304 | كود حقيقي | ❌ يحتاج نقل |
| `opencode-mapping.test.ts` | 78 | test | ❌ ينقل مع الملف |
| `opencode-session-resolver.ts` | 77 | كود حقيقي | ❌ يحتاج نقل |
| `sandbox-reaper.ts` | 711 | كود حقيقي | ❌ يحتاج نقل |
| `sandbox-reaper.test.ts` | 442 | test | ❌ ينقل مع الملف |
| `session-lifecycle/` (7 ملفات) | 1100 | كود حقيقي | ❌ يحتاج نقل |
| `lib/git.ts` | 997 | كود حقيقي | ❌ يحتاج نقل |
| `lib/sessions.ts` | 663 | كود حقيقي | ❌ يحتاج نقل |
| `lib/serializers.ts` | 529 | كود حقيقي | ❌ يحتاج نقل (للموبايل) |
| `lib/access.ts` | 372 | كود حقيقي | ❌ يحتاج نقل |
| `lib/sandbox-env-sync.ts` | 184 | كود حقيقي | ❌ يحتاج نقل |
| `lib/session-runtime-allocator.ts` | 163 | كود حقيقي | ❌ يحتاج نقل |
| `lib/session-runtime-env.ts` | 58 | كود حقيقي | ❌ يحتاج نقل |
| `lib/sandbox-env-names.ts` | 31 | كود حقيقي | ❌ يحتاج نقل |
| `lib/session-status.ts` | 12 | كود حقيقي | ❌ يحتاج نقل |
| `legacy-vm-access.ts` | 224 | كود قديم | ✅ يمكن حذفه |
| `legacy-migration-rehydrate.ts` | 180 | كود قديم | ✅ يمكن حذفه |
| `legacy-migration-storage.ts` | 80 | كود قديم | ✅ يمكن حذفه |
| `routes/shared.ts` | 635 | كود حقيقي | ⚠️ يُبقى كـ deprecated |

#### ملفات محذوفة بالفعل ✅:
- `index.ts` (barrel)
- `change-requests.ts`
- `apps.ts`
- `app-sweep.ts`
- `codex-device-auth.ts`
- `maintenance.ts`
- `suna-migration/` (مجلد كامل)
- `git-proxy/` (مجلد كامل)

### Web — الوضع الحقيقي

#### محذوف بالفعل ✅:
- `app/(app)/projects/` (8 ملفات)
- `features/co-worker/` (15 ملف)
- `features/project-files/` (59 ملف)
- `features/projects/` (4 ملفات)
- `components/projects/` (48 ملف)
- `stores/project-switch-store.ts`
- `stores/projects-view-store.ts`
- `stores/apps-overlay-store.ts`
- `stores/gateway-overlay-store.ts`
- `lib/projects-gateway-client.ts`
- `lib/projects-apps-client.ts`

#### لا يزال موجوداً ❌:

| الملف | السطور | المستوردون | السبب |
|---|---|---|---|
| `lib/projects-client.ts` | **2535** | **34 ملف!** | يستورد منه: accounts, members, invites, marketplace, command-palette, session UI — يحتاج استخراج الـ types المشتركة |
| `stores/project-session-tabs-store.ts` | 41 | 1 | stub — يمكن حذفه |
| `stores/customize-store.ts` | 62 | 1 | stub — يمكن حذفه |
| `lib/customize-sections.ts` | 57 | 1 | dead code — يمكن حذفه |
| `hooks/projects/use-new-project-session.ts` | stub | 0 | stub — يمكن حذفه |
| `.kortix/` | مجلد | 52 مرجع في API | يحتاج تحويل لـ `.vaelorx/` |
| `kortix.toml` | 220 | 82 مرجع في API | يحتاج تحويل لـ `vaelorx.toml` |

### CLI — الوضع الحقيقي

#### محذوف بالفعل ✅:
- `commands/projects.ts`
- `commands/ship.ts`
- `commands/cr.ts`
- `commands/triggers.ts`
- `commands/apps.ts`

#### لا يزال موجوداً ❌:
- `project-link.ts` (86 سطر) — لا مستوردين مباشرين

---

## 📐 الخطة المحدّثة

### القاعدة الذهبية: **لا تكسر الإنتاج ولا الموبايل**

1. `/v1/projects/*` routes تبقى تعمل كـ deprecated shim
2. جداول `project_*` DB تبقى موجودة
3. كل نقل كود يتم BEFORE الحذف
4. اختبار build بعد كل خطوة

---

### Phase 7.0 — نقل الكود المشترك — **متبقٍ: 13 مهمة**

#### ✅ منجز:
- 7.0.2: `shared/manifest.ts` (190 سطر)
- 7.0.4: `shared/policies.ts` (128 سطر)
- `shared/index.ts` barrel (transitional)

#### ❌ متبقٍ:

**7.0.1: نقل `projects/connectors.ts` → `shared/connectors.ts`**
- 497 سطر كود حقيقي
- يُستورد عبر `shared/index.ts` (153 مستورد)
- نقل: `ConnectorSpec`, `ConnectorProvider`, `ChannelPlatform`, `extractConnectors()`, `manifestHashForConnector()`, `RESERVED_CONNECTOR_SLUGS`

**7.0.3: نقل `projects/secrets.ts` → `shared/secrets.ts`**
- 247 سطر كود حقيقي
- نقل: `encryptProjectSecret`, `decryptProjectSecret`, `getProjectSecretValue`, `isValidSecretName`, `writeSharedProjectSecret`

**7.0.5: نقل `projects/opencode-mapping.ts` → `sessions/opencode-mapping.ts`**
- 304 سطر + 78 سطر test

**7.0.6: نقل `projects/opencode-session-resolver.ts` → `sessions/opencode-session-resolver.ts`**
- 77 سطر

**7.0.7: نقل `projects/sandbox-reaper.ts` → `platform/services/sandbox-reaper.ts`**
- 711 سطر + 442 سطر test

**7.0.8: نقل `projects/agents.ts` → `platform/services/agent-grants.ts`**
- 327 سطر

**7.0.9: حذف `projects/starter.ts`** (re-export stub — الكود في `@kortix/starter`)

**7.0.10: نقل `projects/lib/sessions.ts` → `sessions/session-env.ts`**
- 663 سطر

**7.0.11: نقل `projects/lib/sandbox-env-sync.ts` → `sandbox-proxy/sandbox-env-sync.ts`**
- 184 سطر

**7.0.12: نقل `projects/lib/access.ts` → `shared/access.ts`**
- 372 سطر

**7.0.13: نقل `projects/git.ts` + `projects/lib/git.ts` + `projects/git/` → `shared/git.ts`**
- 80 + 997 + 1641 = 2718 سطر (الأكبر!)

**7.0.14: نقل `projects/session-lifecycle/` → `sessions/lifecycle/`**
- 7 ملفات، 1100 سطر

**7.0.15: نقل `projects/lib/sandbox-env-names.ts` + `lib/session-status.ts` + `lib/session-runtime-env.ts` + `lib/session-runtime-allocator.ts`**
- 31 + 12 + 58 + 163 = 264 سطر

**7.0.16: تحديث `shared/index.ts`** — إزالة كل re-exports من `projects/`

---

### Phase 7.1 — حذف كود API — **متبقٍ: ~40 ملف**

بعد اكتمال 7.0:

#### ملفات آمنة للحذف فوراً (لا مستوردين):
```
projects/policies.ts          ← re-export stub
projects/starter.ts           ← re-export stub
projects/access.ts            ← 0 مستوردين
projects/github.ts            ← 0 مستوردين
projects/git-ref.ts           ← 0 مستوردين
projects/apps-config.ts       ← 0 مستوردين
projects/legacy-vm-access.ts  ← 0 مستوردين
projects/legacy-migration-rehydrate.ts ← 0 مستوردين
projects/legacy-migration-storage.ts   ← 0 مستوردين
projects/git-backends/        ← 0 مستوردين (6 ملفات)
```

#### ملفات تُحذف بعد النقل (7.0):
```
projects/connectors.ts        ← بعد النقل لـ shared/connectors.ts
projects/triggers.ts          ← بعد النقل لـ shared/manifest.ts (ملاحظة: partial — manifest.ts نُقل لكن triggers.ts لا يزال يحتوي على code)
projects/secrets.ts           ← بعد النقل لـ shared/secrets.ts
projects/git.ts + git/        ← بعد النقل لـ shared/git.ts
projects/agents.ts            ← بعد النقل
projects/opencode-mapping.ts  ← بعد النقل
projects/opencode-session-resolver.ts ← بعد النقل
projects/sandbox-reaper.ts    ← بعد النقل
projects/session-lifecycle/   ← بعد النقل
projects/lib/                 ← بعد النقل (كل الملفات)
```

#### ملفات تبقى (deprecated shims للموبايل):
```
projects/routes/shared.ts     ← session helpers للموبايل
projects/lib/serializers.ts   ← session serializers للموبايل
```

---

### Phase 7.2 — تنظيف Web — **متبقٍ: 5 ملفات + `.kortix/`**

#### 7.2.1: استخراج الـ types من `projects-client.ts` (2535 سطر، 34 مستورد)

**هذه أصعب مهمة.** 34 ملف يستورد من `projects-client.ts`:
- `listAccountMembers`, `listAccounts`, `getAccount`, `createAccount` — account types (ليست project-specific!)
- `listProjectSecrets`, `upsertProjectSecret` — secrets (admin-only)
- `listProjectSessions`, `restartProjectSession`, `getProjectSession` — session helpers
- `ProjectSession`, `ProjectOpenCodeSession`, `ProjectRole`, `AccountRole` — types
- `ConnectorSharing`, `ProjectOpenCodeSession` — types

**الحل:** إنشاء `lib/accounts-client.ts` للأنواع غير المرتبطة بالمشاريع، و `lib/session-types.ts` للأنواع المشتركة.

#### 7.2.2: حذف الـ stubs
```
stores/project-session-tabs-store.ts  ← 1 مستورد (stub)
stores/customize-store.ts             ← 1 مستورد (stub)
lib/customize-sections.ts             ← 1 مستورد (dead code)
hooks/projects/use-new-project-session.ts ← 0 مستوردين (stub)
```

#### 7.2.3: تحويل `.kortix/` → `.vaelorx/` (52 مرجع في API)
#### 7.2.4: تحويل `kortix.toml` → `vaelorx.toml` (82 مرجع في API)

---

### Phase 7.3 — تنظيف CLI — **متبقٍ: 1 ملف**

```
apps/cli/src/project-link.ts ← 86 سطر، 0 مستوردين مباشرين
```

---

### Phase 7.4 — حذف جداول DB — **مؤجل**

كما هو مخطط — لا يتم تنفيذه حتى اكتمال تحويل الموبايل.

---

## 📊 ملخص الجهد المتبقٍ

| المرحلة | المتبقٍ | الجهد |
|---|---|---|
| **7.0** | 13 مهمة نقل (~8000 سطر كود) | 2 يوم |
| **7.1** | ~40 ملف للحذف | 0.5 يوم |
| **7.2** | 5 ملفات + استخراج types من projects-client.ts + .kortix/kortix.toml | 1.5 يوم |
| **7.3** | 1 ملف | 0.1 يوم |
| **7.4** | مؤجل | — |
| **الإجمالي** | | **~4 أيام** |

---

## ⚠️ الترتيب الحرج

```
7.0 (نقل الكود) → 7.1 (حذف API) → 7.2 (تنظيف Web) → 7.3 (تنظيف CLI) → 7.4 (DB — مؤجل)
```

**لا يمكن تخطي 7.0** — بدون نقل الكود المشترك، حذف `projects/` سيكسر 153 ملف.

---

**آخر تحديث:** 2026-07-21 — فحص فعلي للكود
