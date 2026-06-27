# خطة الانتقال من Daytona إلى Tensorlake — VaelorX

## نظرة عامة

هذه الخطة تغطي الانتقال التدريجي من Daytona Sandbox Provider إلى Tensorlake Sandbox Provider
لمشروع Suna/VaelorX. الاستراتيجية هي **Dual-Provider** — إضافة Tensorlake كـ provider رابع
بجانب daytona/local_docker/platinum، مما يسمح بالاختبار التدريجي والتراجع الفوري.

---

## الفاز 1: البنية التحتية (الأسبوع 1)

### 1.1 تثبيت Tensorlake SDK

```bash
cd apps/api
npm install tensorlake
```

### 1.2 إضافة متغيرات البيئة

```env
# config.ts — إضافة
TENSORLAKE_API_KEY:             optStr,
TENSORLAKE_DEFAULT_IMAGE:       optStrDefault('tensorlake/ubuntu-systemd'),
TENSORLAKE_SANDBOX_TIMEOUT_SECS: optIntDefault(600),
TENSORLAKE_WARM_SNAPSHOT:       optStr,        // warm base snapshot ID
```

### 1.3 تحديث ProviderName type

```typescript
// providers/index.ts
export type ProviderName = 'daytona' | 'local_docker' | 'platinum' | 'tensorlake';
```

### 1.4 إنشاء shared/tensorlake.ts — SDK Client Factory

```typescript
// Singleton Tensorlake SDK client
import { Sandbox } from "tensorlake";

export function getTensorlake(): typeof Sandbox { ... }
export function isTensorlakeConfigured(): boolean { ... }
```

---

## الفاز 2: TensorlakeProvider (الأسبوع 1-2)

### 2.1 إنشاء providers/tensorlake.ts

تنفيذ كامل لـ `SandboxProvider` interface:

| Method | Daytona | Tensorlake | ملاحظات |
|--------|---------|------------|---------|
| `create()` | `daytona.create({snapshot, ...})` | `Sandbox.create({image/snapshotId, ...})` | دعم cold + warm |
| `start()` | `sandbox.start()` | `Sandbox.connect(id).resume()` | Named sandboxes فقط |
| `stop()` | `sandbox.stop()` | `Sandbox.connect(id).suspend()` | يحفظ الذاكرة |
| `remove()` | `sandbox.delete()` | `Sandbox.connect(id).terminate()` | نهائي |
| `getStatus()` | `sandbox.info()` | `Sandbox.connect(id).info()` | مع TTL cache |
| `resolveEndpoint()` | `getPreviewLink(8000)` | `https://8000-{id}.sandbox.tensorlake.ai` | + headers |
| `resolvePreviewLink()` | `getPreviewLink(port)` | `https://{port}-{id}.sandbox.tensorlake.ai` | + exposed_ports |
| `ensureRunning()` | check + start | check + resume | نفس المنطق |
| `listManagedRunningSandboxes()` | `daytona.list({labels})` | `Sandbox.list()` + filter by name prefix | حل بديل |

#### تفاصيل create()

```typescript
async create(opts: CreateSandboxOpts): Promise<ProvisionResult> {
  const sandboxOpts: any = {
    cpus: 2.0,
    memoryMb: 4096,
    timeoutSecs: opts.autoStopInterval || 600,
  };

  // Cold path: boot from per-project snapshot
  if (opts.snapshot) {
    sandboxOpts.snapshotId = opts.snapshot;
  }
  // Warm path: boot from warm base snapshot
  else if (opts.warmBaseSnapshot) {
    sandboxOpts.snapshotId = opts.warmBaseSnapshot;
  }
  // Default image
  else {
    sandboxOpts.image = config.TENSORLAKE_DEFAULT_IMAGE;
  }

  // Name: use session name (enables suspend/resume)
  if (opts.name) {
    sandboxOpts.name = `vaelorx-${opts.accountId}-${opts.name}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 60);
  }

  // Network: allow unrestricted egress (agent needs internet)
  sandboxOpts.allowInternetAccess = true;

  const sandbox = await Sandbox.create(sandboxOpts);

  // Expose the agent daemon port
  await sandbox.update({
    exposedPorts: [8000],
    allowUnauthenticatedAccess: false,
  });

  // Write env vars if provided
  if (opts.envVars) {
    const envContent = Object.entries(opts.envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    await sandbox.write_file(
      '/home/tl-user/.vaelorx-env',
      new TextEncoder().encode(envContent)
    );
  }

  const id = sandbox.sandboxId;
  const baseUrl = `https://8000-${id}.sandbox.tensorlake.ai`;

  return {
    externalId: id,
    baseUrl,
    metadata: { name: sandbox.name, status: 'running' },
  };
}
```

#### تفاصيل resolveEndpoint()

```typescript
async resolveEndpoint(externalId: string): Promise<ResolvedEndpoint> {
  const sandbox = Sandbox.connect(externalId);
  const info = await sandbox.info();
  const id = info.sandboxId;

  return {
    url: `https://8000-${id}.sandbox.tensorlake.ai`,
    headers: {
      'Authorization': `Bearer ${config.TENSORLAKE_API_KEY}`,
      // لا حاجة لـ Daytona-specific headers
    },
  };
}
```

#### تفاصيل resolvePreviewLink()

```typescript
async resolvePreviewLink(externalId: string, port: number): Promise<{ url: string; token: string | null }> {
  const sandbox = Sandbox.connect(externalId);
  const info = await sandbox.info();
  const id = info.sandboxId;

  // Ensure port is exposed
  const currentPorts = info.exposedPorts || [];
  if (!currentPorts.includes(port)) {
    await sandbox.update({
      exposedPorts: [...currentPorts, port],
      allowUnauthenticatedAccess: false,
    });
  }

  return {
    url: `https://${port}-${id}.sandbox.tensorlake.ai`,
    token: config.TENSORLAKE_API_KEY,  // Auth token for the proxy
  };
}
```

---

## الفاز 3: Snapshot Adapter (الأسبوع 2)

### 3.1 إنشاء snapshots/providers/tensorlake.ts

تنفيذ `SandboxProviderAdapter` interface:

```typescript
class TensorlakeAdapter implements SandboxProviderAdapter {
  readonly id = 'tensorlake';

  async buildSnapshot(input: BuildableTemplate, tap?: BuildLogTap): Promise<void> {
    // Use Image Build API instead of daytona.snapshot.create()
    const image = new Image({
      name: input.snapshotName,
      baseImage: 'tensorlake/ubuntu-systemd',
    });
    // ... apply Dockerfile steps as Image DSL commands
    await image.build({ registeredName: input.snapshotName });
  }

  async getSnapshotState(name: string): Promise<ProviderState> {
    // Use findSandboxImageByName
    const image = await findSandboxImageByName(name);
    if (!image) return { state: 'missing' };
    return { state: 'active' };  // If image exists, it's ready
  }

  async deleteSnapshot(name: string): Promise<void> {
    // Delete the registered image
  }
}
```

### 3.2 تحديث Warm Bake لدعم Tensorlake

```typescript
// warm-bake.ts additions
async function bakeWarmSnapshotTensorlake(): Promise<string> {
  // 1. Create builder sandbox
  const builder = await Sandbox.create({
    image: 'tensorlake/ubuntu-systemd',
    cpus: 4.0,
    memoryMb: 8192,
    name: 'vaelorx-warm-builder',
  });

  // 2. Install runtime imperatively
  await builder.run("bash", { args: ["-c", "apt-get update && apt-get install -y ..."] });
  await builder.run("pip", { args: ["install", "--break-system-packages", ...] });

  // 3. Upload Kortix binaries
  await builder.write_file("/usr/local/bin/kortix-agent", runtimeArtifact);

  // 4. Create MEMORY checkpoint (official API, not experimental!)
  const snapshot = await builder.checkpoint({ checkpointType: "memory" });

  // 5. Cleanup
  await builder.terminate();

  return snapshot.snapshotId;
}
```

**ميزة Tensorlake**: `checkpoint(type=MEMORY)` هو API **رسمي** وليس تجريبي
مثل `_experimental_createSnapshot` في Daytona. هذا يزيل كل الـ retry logic
المعقدة في warm-bake.ts.

---

## الفاز 4: حل مشكلة Webhooks (الأسبوع 2-3)

### المشكلة
Daytona يرسل Svix webhooks عند توقف/حذف sandbox → مصالحة فورية للفوترة.
Tensorlake لا يملك webhook system.

### الحل: Polling Service + Event Stream

```typescript
// platform/services/tensorlake-reconciler.ts

const RECONCILE_INTERVAL_MS = 30_000; // 30 ثانية

export class TensorlakeReconciler {
  private knownSandboxes: Map<string, SandboxStatus> = new Map();
  private interval: NodeJS.Timer | null = null;

  start() {
    this.interval = setInterval(() => this.reconcile(), RECONCILE_INTERVAL_MS);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private async reconcile() {
    // 1. Get all managed sandboxes from DB
    const dbSandboxes = await getActiveTensorlakeSandboxes();

    // 2. Check actual status from Tensorlake
    for (const record of dbSandboxes) {
      try {
        const info = await Sandbox.connect(record.externalId).info();

        if (info.status === 'suspended' && this.knownSandboxes.get(record.externalId) === 'running') {
          // Sandbox was running, now suspended → stop billing
          await reconcileSandboxStoppedByExternalId(record.externalId);
        }
        if (info.status === 'terminated') {
          // Sandbox terminated → remove billing
          await reconcileSandboxRemovedByExternalId(record.externalId);
        }

        this.knownSandboxes.set(record.externalId, info.status as SandboxStatus);
      } catch {
        // Sandbox not found → removed externally
        await reconcileSandboxRemovedByExternalId(record.externalId);
        this.knownSandboxes.delete(record.externalId);
      }
    }
  }
}
```

### تحسين: SSE-based Event Stream (مرحلة لاحقة)

```typescript
// يمكن تحسينه لاحقاً باستخدام follow_output على process
// يراقب سجل الأحداث داخل sandbox
```

---

## الفاز 5: تعديل Proxy (الأسبوع 3)

### 5.1 تعديل sandbox-proxy/backend.ts

```typescript
// في buildSandboxUpstreamHeaders()
// إضافة دعم Tensorlake:
if (record.provider === 'tensorlake') {
  headers['Authorization'] = `Bearer ${config.TENSORLAKE_API_KEY}`;
  // لا حاجة لـ X-Daytona-* headers
  // لا حاجة لـ skip-warning أو disable-CORS
}
```

### 5.2 تعديل sandbox-proxy/routes/preview.ts

```typescript
// Proxy يعمل بنفس المنطق، لكن:
// - Daytona: يحتاج preview link resolution → cached signed URL
// - Tensorlake: URL ثابت: https://{port}-{id}.sandbox.tensorlake.ai
// - لا حاجة لـ preview link caching مع Tensorlake
```

---

## الفاز 6: ميزات Tensorlake الجديدة (الأسبوع 3-4)

### 6.1 Managed Processes — استقرار الـ Daemon

**المشكلة الحالية**: kortix-agent daemon قد يتحطم داخل sandbox،
ولا توجد آلية auto-restart في Daytona.

**الحل مع Tensorlake**:

```typescript
// بدلاً من تشغيل daemon كعملية عادية:
await sandbox.startProcess("python", {
  args: ["/usr/local/bin/kortix-agent"],
  name: "kortix-daemon",
  restart: {
    policy: "always",
    maxRestarts: 10,
    initialBackoffMs: 500,
    maxBackoffMs: 30_000,
  },
  healthCheck: {
    type: "http",
    port: 8000,
    path: "/health",
    intervalMs: 5_000,
    failureThreshold: 3,
  },
});
```

هذا يضمن:
- Daemon يعيد تشغيل نفسه تلقائياً عند التحطم
- Health check يكتشف المشاكل مبكراً
- Exponential backoff يمنع restart storm

### 6.2 Computer Use — Browser Agent متقدم

**إمكانية جديدة**: تشغيل XFCE desktop + Firefox داخل sandbox
لأتمتة المتصفح بشكل مرئي (ليس headless فقط).

```typescript
// إنشاء desktop sandbox
const sandbox = await Sandbox.create({
  image: 'tensorlake/ubuntu-vnc',
  cpus: 4.0,
  memoryMb: 8192,
});

// التحكم في desktop
const desktop = await sandbox.connectDesktop({ password: 'tensorlake' });
const screenshot = await desktop.screenshot();
await desktop.moveMouse(640, 400);
await desktop.click();
await desktop.typeText('hello');
```

**استخدام في VaelorX**:
- Agent يمكنه تصفح مواقع ويب معقدة (SPA, CAPTCHAs)
- Screenshot-based verification للنتائج
- ملائم لمهام web scraping معقدة

### 6.3 Chrome CDP — أتمتة متصفح احترافية

```typescript
// تشغيل Chrome مع CDP
await sandbox.startProcess("sudo", {
  args: ["-u", "tl-user", "env", "DISPLAY=:1",
    "google-chrome", "--remote-debugging-port=9222",
    "--remote-allow-origins=*", "--user-data-dir=/tmp/chrome-cdp"],
});

// فتح tunnel من localhost
const tunnel = await sandbox.createTunnel(9222, { localPort: 9222 });

// استخدام Playwright
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
```

**استخدام في VaelorX**:
- Agent يتحكم في متصفح حقيقي عبر Playwright/Puppeteer
- ملائم لمهام الـ form filling, data extraction, testing
- أفضل من headless scraping لأنه يتجاوز bot detection

### 6.4 Local Tunnels — وصول آمن للخدمات الداخلية

```typescript
// Tunnel أي TCP port بدون exposing publicly
const tunnel = await sandbox.createTunnel(5432, { localPort: 15432 });
// الآن يمكن الوصول لـ PostgreSQL داخل sandbox من localhost:15432
```

**استخدام في VaelorX**:
- وصول آمن لـ databases داخل sandbox
- لا حاجة لـ expose ports publicly
- مفيد لـ debugging و data extraction

### 6.5 Docker داخل Sandbox

```typescript
// إنشاء sandbox مع systemd (يدعم Docker)
const sandbox = await Sandbox.create({
  image: 'tensorlake/ubuntu-systemd',
  cpus: 2.0,
  memoryMb: 4096,
});

// تثبيت Docker
await sandbox.run("bash", {
  args: ["-c", "apt-get update && apt-get install -y docker-ce docker-ce-cli ..."],
});

// تشغيل حاويات Docker داخل sandbox
await sandbox.run("docker", { args: ["run", "hello-world"] });
```

**استخدام في VaelorX**:
- تشغيل أي service داخل sandbox (databases, APIs, etc.)
- عزل إضافي layer داخل sandbox
- ملائم لمهام development/testing

---

## الفاز 7: تحسينات الأداء (الأسبوع 4)

### 7.1 Warm Boot Optimization

Tensorlake يدعم نوعين من checkpoints:

| النوع | الالتقاط | الاستعادة | السرعة |
|-------|----------|-----------|--------|
| `FILESYSTEM` | ملفات فقط | Cold boot | ~3-5 ثواني |
| `MEMORY` | ملفات + ذاكرة + عمليات | Warm restore | ~0.6-1.3 ثانية |

**استراتيجية VaelorX**:
1. بناء **filesystem snapshot** لكل مشروع (من Dockerfile)
2. بناء **memory snapshot** واحد للـ runtime (opencode + daemon + tools)
3. عند إنشاء session: boot من memory snapshot + تخصيص per-project

### 7.2 Suspend/Resume بدلاً من Stop/Start

في Daytona: `stop()` → sandbox يتوقف بالكامل، `start()` → cold boot.
في Tensorlake: `suspend()` → sandbox يُحفظ في مكانه، `resume()` → استعادة فورية.

**فائدة**: عندما يكون agent غير نشط مؤقتاً، suspend يوفر التكلفة
مع الحفاظ على كل الحالة (عمليات جارية، ملفات مفتوحة، shell history).

### 7.3 Named Sandboxes — Session Persistence

```typescript
// إنشاء named sandbox يدعم suspend/resume
const sandbox = await Sandbox.create({
  name: `vaelorx-${accountId}-${sessionId}`,
  cpus: 2.0,
  memoryMb: 4096,
  timeoutSecs: 1800,  // auto-suspend بعد 30 دقيقة idle
});
```

عندما يعود المستخدم: `Sandbox.connect(name).resume()` —
كل شيء كما تركه (tmux sessions، open files، running processes).

---

## جدول زمني

| الأسبوع | المهمة | المخرجات |
|---------|--------|----------|
| 1 | البنية التحتية + Provider أساسي | tensorlake.ts provider يعمل |
| 2 | Snapshot Adapter + Warm Bake | بناء صور و warm snapshots |
| 3 | Polling Reconciler + Proxy | فوترة دقيقة + proxy يعمل |
| 4 | ميزات جديدة + تحسينات | Managed processes, Computer Use |
| 5 | اختبار شامل + staging | Dual-provider في production |

---

## مقارنة التكلفة المتوقعة

| العامل | Daytona | Tensorlake |
|--------|---------|------------|
| Cold boot | ~8-12 ثانية | ~3-5 ثانية (filesystem) / ~1 ثانية (memory) |
| Warm boot | ~1.3 ثانية (experimental) | ~0.6-1.3 ثانية (رسمي) |
| Suspend/Resume | غير مدعوم (stop/start فقط) | مدعوم (يحفظ الذاكرة) |
| Sandbox stability | experimental region غير مستقر | رسمي ومستقر |
| SDK | @daytonaio/sdk | tensorlake (TypeScript رسمي) |
| Security | - | SOC 2, HIPAA, EU residency |
| Webhooks | ✅ Svix | ❌ (polling بديل) |
| Labels | ✅ تعسفية | ❌ (اسم فقط) |

---

## مخاطر متبقية

| المخاطرة | الاحتمال | التأثير | التخفيف |
|----------|----------|---------|---------|
| غياب Webhooks يؤخر مصالحة الفوترة | متوسط | منخفض | Polling كل 30 ثانية + Reaper |
| غياب Labels يربك الـ Reaper | منخفض | متوسط | Name prefix + DB tracking |
| اختلاف سلوك suspend/resume | منخفض | منخفض | اختبار شامل |
| تكلفة API calls أكثر (polling) | متوسط | منخفض | Cache + throttle |
| مشاكل في Tensorlake SDK جديدة | متوسط | متوسط | Dual-provider مع fallback |

---

## الخطوة التالية

بعد إكمال الفاز 1-2، يمكن تشغيل Tensorlake كـ provider تجريبي
على subset من الـ sessions مع مقارنة الأداء والتكلفة مع Daytona.
إذا كانت النتائج إيجابية، يتم تحويل المزيد من الـ traffic تدريجياً.
