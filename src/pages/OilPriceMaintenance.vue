<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { TEMPERATURE_LIMITS, STANDARD_TEMPERATURE, findFuel, type FuelSpec } from "../archive/masterData";
import {
  evaluateCompensation,
  isMeasurable,
  type CompensationResult,
  type Violation
} from "../conversion/compensation";
import {
  loadState,
  saveFuels,
  saveRegistrations,
  makeId,
  type Registration,
  type RegistrationVersion
} from "../storage/persistence";

type FormMode = "create" | "edit" | "correct";

interface FormState {
  fuelName: string;
  observedVolume: number | "";
  temperature: number | "";
  observedDensity: number | "";
  certificateDensity: number | "";
  operator: string;
  reason: string;
}

const initial = loadState();
const fuels = ref<FuelSpec[]>(initial.fuels);
const registrations = ref<Registration[]>(initial.registrations);
const catalogDraft = ref<FuelSpec[]>(fuels.value.map((fuel) => ({ ...fuel })));

const filter = ref("全部油品");
const formMode = ref<FormMode>("create");
const editingId = ref<string | null>(null);
const formError = ref("");
const expanded = ref<Record<string, boolean>>({});

function blankForm(): FormState {
  return {
    fuelName: fuels.value[0]?.name ?? "",
    observedVolume: "",
    temperature: "",
    observedDensity: "",
    certificateDensity: "",
    operator: "",
    reason: ""
  };
}

const form = reactive<FormState>(blankForm());
const formTitle = computed(() => {
  if (formMode.value === "edit") return "编辑待复核登记";
  if (formMode.value === "correct") return "更正已复核登记（新建版本）";
  return "计量温度补偿登记";
});
const submitText = computed(() => {
  if (formMode.value === "edit") return "保存修改";
  if (formMode.value === "correct") return "提交更正版本";
  return "登记";
});

const formFuel = computed(() => findFuel(fuels.value, form.fuelName));
const formMeasurable = computed(() =>
  isMeasurable({
    observedVolume: Number(form.observedVolume),
    temperature: Number(form.temperature),
    observedDensity: Number(form.observedDensity)
  })
);

const preview = computed<CompensationResult | null>(() => {
  const fuel = formFuel.value;
  if (!fuel || !formMeasurable.value) return null;
  return evaluateCompensation({
    fuel,
    observedVolume: Number(form.observedVolume),
    temperature: Number(form.temperature),
    observedDensity: Number(form.observedDensity)
  });
});

const previewAmount = computed(() => {
  const fuel = formFuel.value;
  if (!fuel || !preview.value) return null;
  return preview.value.standardVolume * fuel.listPrice;
});

/* ---------------- 版本视图：已复核用冻结值，待复核按当前档案实时换算 ---------------- */

function versionComp(version: RegistrationVersion): CompensationResult | null {
  const fuel = findFuel(fuels.value, version.fuelName);
  if (!fuel) return null;
  if (version.frozen) {
    return {
      vcf: version.frozen.vcf,
      standardDensity: version.frozen.standardDensity,
      standardVolume: version.frozen.standardVolume,
      densityDeltaPermille: 0,
      mass: version.frozen.mass,
      violations: [],
      valid: true
    };
  }
  if (!isMeasurable(version)) return null;
  return evaluateCompensation({
    fuel,
    observedVolume: version.observedVolume,
    temperature: version.temperature,
    observedDensity: version.observedDensity
  });
}

function violationsOf(version: RegistrationVersion): Violation[] {
  if (version.frozen) return [];
  return versionComp(version)?.violations ?? [];
}

function statusMeta(version: RegistrationVersion): { text: string; cls: string } {
  if (version.status === "confirmed") return { text: "已复核（结算已冻结）", cls: "ok" };
  if (version.status === "superseded") return { text: "已替代（旧值保留）", cls: "old" };
  return violationsOf(version).length > 0
    ? { text: "异常暂停（不入均价）", cls: "warn" }
    : { text: "待复核（不入均价）", cls: "pending" };
}

function currentVersion(reg: Registration): RegistrationVersion {
  return reg.versions.find((item) => item.version === reg.currentVersion) ?? reg.versions[reg.versions.length - 1];
}

/* ---------------- 均价：仅当前版本为已复核、冻结结算的记录参与，按标准升加权 ---------------- */

interface AverageRow {
  name: string;
  liters: number;
  amount: number;
  avg: number | null;
}

const averages = computed<AverageRow[]>(() => {
  const rows: AverageRow[] = fuels.value.map((fuel) => {
    let liters = 0;
    let amount = 0;
    for (const reg of registrations.value) {
      const version = currentVersion(reg);
      if (version.fuelName !== fuel.name || version.status !== "confirmed" || !version.frozen) continue;
      liters += version.frozen.standardVolume;
      amount += version.frozen.amount;
    }
    return { name: fuel.name, liters, amount, avg: liters > 0 ? amount / liters : null };
  });
  return rows;
});

const overallAvg = computed(() => {
  const liters = averages.value.reduce((sum, row) => sum + row.liters, 0);
  const amount = averages.value.reduce((sum, row) => sum + row.amount, 0);
  return liters > 0 ? amount / liters : null;
});

/* ---------------- 指标与图 ---------------- */

const pendingCount = computed(
  () =>
    registrations.value.filter((reg) => {
      const version = currentVersion(reg);
      return version.status === "pending" && violationsOf(version).length === 0;
    }).length
);

const suspendedCount = computed(
  () =>
    registrations.value.filter((reg) => {
      const version = currentVersion(reg);
      return version.status === "pending" && violationsOf(version).length > 0;
    }).length
);

const confirmedCount = computed(
  () => registrations.value.filter((reg) => currentVersion(reg).status === "confirmed").length
);

const supersededCount = computed(
  () => registrations.value.reduce((sum, reg) => sum + reg.versions.filter((v) => v.status === "superseded").length, 0)
);

const chartRows = computed(() => [
  { status: "待复核", value: pendingCount.value, cls: "pending" },
  { status: "异常暂停", value: suspendedCount.value, cls: "warn" },
  { status: "已复核", value: confirmedCount.value, cls: "ok" },
  { status: "已替代", value: supersededCount.value, cls: "old" }
]);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

/** 列表项视图：当前版本 + 按档案实时重算/冻结读取的补偿明细 */
interface RegistrationView {
  reg: Registration;
  version: RegistrationVersion;
  comp: CompensationResult | null;
  violations: Violation[];
}

function buildView(reg: Registration): RegistrationView {
  const version = currentVersion(reg);
  const comp = versionComp(version);
  const violations = version.frozen ? [] : comp?.violations ?? [];
  return { reg, version, comp, violations };
}

const filtered = computed<RegistrationView[]>(() => {
  const list =
    filter.value === "全部油品"
      ? registrations.value
      : registrations.value.filter((reg) => currentVersion(reg).fuelName === filter.value);
  return list.map(buildView);
});

/* ---------------- 格式化 ---------------- */

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${fmt(value, digits)}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function persist() {
  saveRegistrations(registrations.value);
}

/* ---------------- 登记 / 编辑 / 更正 ---------------- */

function resetForm() {
  Object.assign(form, blankForm());
  formMode.value = "create";
  editingId.value = null;
  formError.value = "";
}

function startEdit(reg: Registration) {
  const version = currentVersion(reg);
  if (version.status !== "pending") return;
  formMode.value = "edit";
  editingId.value = reg.id;
  Object.assign(form, {
    fuelName: version.fuelName,
    observedVolume: version.observedVolume,
    temperature: version.temperature,
    observedDensity: version.observedDensity,
    certificateDensity: version.certificateDensity,
    operator: version.operator,
    reason: ""
  });
  formError.value = "";
}

function startCorrect(reg: Registration) {
  const version = currentVersion(reg);
  if (version.status !== "confirmed" || !version.frozen) return;
  formMode.value = "correct";
  editingId.value = reg.id;
  Object.assign(form, {
    fuelName: version.fuelName,
    observedVolume: version.observedVolume,
    temperature: version.temperature,
    observedDensity: version.observedDensity,
    certificateDensity: version.certificateDensity,
    operator: version.operator,
    reason: ""
  });
  formError.value = "";
}

function buildVersion(version: number, reason: string): RegistrationVersion {
  const result = preview.value!;
  return {
    version,
    status: "pending",
    fuelName: form.fuelName,
    observedVolume: Number(form.observedVolume),
    temperature: Number(form.temperature),
    observedDensity: Number(form.observedDensity),
    certificateDensity: Number(form.certificateDensity),
    standardDensity: result.standardDensity,
    vcf: result.vcf,
    standardVolume: result.standardVolume,
    reason,
    operator: form.operator.trim() || "操作员",
    reviewer: "",
    createdAt: new Date().toISOString()
  };
}

function submit() {
  formError.value = "";
  if (!formFuel.value) {
    formError.value = "请选择油品。";
    return;
  }
  if (!formMeasurable.value) {
    formError.value = "视体积、油温、视密度必须为有效数值，且视体积、视密度大于 0。";
    return;
  }
  if (!form.operator.trim()) {
    formError.value = "请填写操作员。";
    return;
  }
  if (formMode.value === "correct" && !form.reason.trim()) {
    formError.value = "更正必须填写更正原因；旧版本结算值将保留。";
    return;
  }
  if (formMode.value === "create") {
    registrations.value = [
      { id: makeId(), currentVersion: 1, versions: [buildVersion(1, "首次登记")] },
      ...registrations.value
    ];
  } else if (formMode.value === "edit" && editingId.value) {
    const reg = registrations.value.find((item) => item.id === editingId.value);
    const index = reg ? reg.versions.findIndex((item) => item.version === reg.currentVersion) : -1;
    if (reg && index >= 0) {
      const old = reg.versions[index];
      reg.versions[index] = buildVersion(old.version, old.reason);
    }
  } else if (formMode.value === "correct" && editingId.value) {
    const reg = registrations.value.find((item) => item.id === editingId.value);
    if (reg) {
      const old = currentVersion(reg);
      // 旧值保留，仅标记为已替代；新原因版本待复核，确认前不影响均价
      old.status = "superseded";
      const next = buildVersion(reg.currentVersion + 1, form.reason.trim());
      reg.versions.push(next);
      reg.currentVersion = next.version;
    }
  }
  persist();
  resetForm();
}

/* ---------------- 复核确认：校验通过才冻结结算，否则保持暂停 ---------------- */

function confirmRegistration(reg: Registration) {
  const version = currentVersion(reg);
  if (version.status !== "pending") return;
  const fuel = findFuel(fuels.value, version.fuelName);
  const comp = versionComp(version);
  if (!fuel || !comp || !comp.valid) return; // 未复核/异常记录不能进入均价
  const amount = comp.standardVolume * fuel.listPrice;
  version.status = "confirmed";
  version.frozen = {
    unitPrice: fuel.listPrice,
    amount,
    standardVolume: comp.standardVolume,
    vcf: comp.vcf,
    standardDensity: comp.standardDensity,
    mass: comp.mass,
    frozenAt: new Date().toISOString(),
    confirmedBy: version.reviewer.trim() || "复核员"
  };
  persist();
}

function remove(reg: Registration) {
  const version = currentVersion(reg);
  if (window.confirm(`确定删除该笔登记（${version.fuelName}，共 ${reg.versions.length} 个版本）？`)) {
    registrations.value = registrations.value.filter((item) => item.id !== reg.id);
    if (editingId.value === reg.id) resetForm();
    persist();
  }
}

function saveCatalog() {
  for (const fuel of catalogDraft.value) {
    if (!Number.isFinite(fuel.listPrice) || fuel.listPrice <= 0) {
      window.alert(`${fuel.name} 挂牌价必须为大于 0 的数字。`);
      return;
    }
    if (!Number.isFinite(fuel.tankCapacity) || fuel.tankCapacity <= 0) {
      window.alert(`${fuel.name} 罐容必须为大于 0 的数字。`);
      return;
    }
  }
  fuels.value = catalogDraft.value.map((fuel) => ({ ...fuel }));
  catalogDraft.value = fuels.value.map((fuel) => ({ ...fuel }));
  saveFuels(fuels.value);
}

function resetCatalog() {
  catalogDraft.value = fuels.value.map((fuel) => ({ ...fuel }));
}

async function copySummary(reg: Registration) {
  const version = currentVersion(reg);
  const comp = versionComp(version);
  const price = version.frozen
    ? `结算 ${fmt(version.frozen.amount)} 元 @ ${fmt(version.frozen.unitPrice, 2)} 元/标准升`
    : comp
      ? `预估 ${fmt(comp.standardVolume * (findFuel(fuels.value, version.fuelName)?.listPrice ?? 0))} 元（未复核）`
      : "暂无可结算数据";
  await navigator.clipboard?.writeText(`${version.fuelName}｜标准升 ${fmt(comp?.standardVolume)}｜${price}`);
}

function certificateDelta(version: RegistrationVersion): number | null {
  const comp = versionComp(version);
  if (!comp || !Number.isFinite(version.certificateDensity)) return null;
  return ((comp.standardDensity - version.certificateDensity) / version.certificateDensity) * 1000;
}

function toggle(regId: string) {
  expanded.value[regId] = !expanded.value[regId];
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 计量温度补偿</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            登记视体积、油温、视密度与标准密度，按 GB/T 1885 体积修正系数折算标准升计价；
            复核确认后冻结结算值，更正生成原因版本并保留旧值，未复核记录不进入均价。
          </p>
        </div>
        <div class="stack">
          <span class="tag">标准温度 {{ STANDARD_TEMPERATURE }}℃</span>
          <span class="tag">油温 {{ TEMPERATURE_LIMITS.min }}℃ ~ {{ TEMPERATURE_LIMITS.max }}℃</span>
          <span class="tag">档案 / 换算 / 存储 / 页面分离</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>登记笔数</span>
          <strong>{{ registrations.length }}</strong>
        </article>
        <article class="metric">
          <span>待复核</span>
          <strong>{{ pendingCount }}</strong>
        </article>
        <article class="metric metric-warn">
          <span>异常暂停（保留输入）</span>
          <strong>{{ suspendedCount }}</strong>
        </article>
        <article class="metric metric-ok">
          <span>已复核（结算冻结）</span>
          <strong>{{ confirmedCount }}</strong>
        </article>
        <article class="metric metric-price">
          <span>综合结算均价（元/标准升）</span>
          <strong>{{ overallAvg === null ? "—" : fmt(overallAvg, 4) }}</strong>
        </article>
      </section>

      <section class="catalog panel">
        <div class="catalog-head">
          <h2>油品档案</h2>
          <p>维护挂牌价与罐容；密度范围、参考标准密度与温度系数为档案参数。改动保存后对未复核记录立即生效，已复核结算不受影响。</p>
          <div class="actions">
            <button type="button" @click="saveCatalog">保存档案</button>
            <button type="button" class="secondary" @click="resetCatalog">还原</button>
          </div>
        </div>
        <div class="catalog-grid">
          <div v-for="fuel in catalogDraft" :key="fuel.code" class="catalog-row">
            <strong>{{ fuel.name }}</strong>
            <label>
              挂牌价 元/升
              <input v-model.number="fuel.listPrice" type="number" min="0" step="0.01" />
            </label>
            <label>
              罐容 L
              <input v-model.number="fuel.tankCapacity" type="number" min="0" step="100" />
            </label>
            <label>
              密度范围 kg/L
              <input :value="`${fuel.minDensity} ~ ${fuel.maxDensity}`" readonly />
            </label>
            <label>
              参考ρ₂₀ / α
              <input :value="`${fuel.referenceDensity} / ${fuel.expansionCoefficient}`" readonly />
            </label>
          </div>
        </div>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>{{ formTitle }}</h2>
          <div class="form-grid">
            <label>
              油品
              <select v-model="form.fuelName" :disabled="formMode !== 'create'" required>
                <option v-for="fuel in fuels" :key="fuel.code" :value="fuel.name">{{ fuel.name }}</option>
              </select>
            </label>
            <label>
              视体积 Vt（L）
              <input v-model.number="form.observedVolume" type="number" step="0.01" min="0" required />
            </label>
            <label>
              油温 t（℃，允许 {{ TEMPERATURE_LIMITS.min }} ~ {{ TEMPERATURE_LIMITS.max }}）
              <input v-model.number="form.temperature" type="number" step="0.1" required />
            </label>
            <label>
              视密度 ρt（kg/L）
              <input v-model.number="form.observedDensity" type="number" step="0.0001" min="0" required />
            </label>
            <label>
              登记标准密度 ρ₂₀（化验单，kg/L）
              <input v-model.number="form.certificateDensity" type="number" step="0.0001" min="0" required />
            </label>
            <label>
              操作员
              <input v-model="form.operator" type="text" required />
            </label>
            <label v-if="formMode === 'correct'">
              更正原因（必填，旧值保留）
              <textarea v-model="form.reason" placeholder="例如：视体积录入错误，按发油单修正" />
            </label>

            <div v-if="preview" class="preview" :class="{ invalid: !preview.valid }">
              <h3>温度补偿明细（可核）</h3>
              <p class="formula">
                VCF = 1 - α×(t - {{ STANDARD_TEMPERATURE }}) =
                1 - {{ formFuel?.expansionCoefficient }}×({{ form.temperature }} - {{ STANDARD_TEMPERATURE }})
                = <strong>{{ fmt(preview.vcf, 6) }}</strong>
              </p>
              <div class="preview-grid">
                <span>标准体积 V₂₀：<strong>{{ fmt(preview.standardVolume) }} L</strong></span>
                <span>标准密度 ρ₂₀：<strong>{{ fmt(preview.standardDensity, 4) }} kg/L</strong></span>
                <span>质量 m：{{ fmt(preview.mass) }} kg</span>
                <span>与档案参考ρ₂₀偏差：{{ fmtSigned(preview.densityDeltaPermille, 2) }} ‰</span>
                <span>挂牌价：{{ fmt(formFuel?.listPrice ?? 0, 2) }} 元/标准升</span>
                <span>预估结算：{{ fmt(previewAmount) }} 元（复核冻结后生效）</span>
              </div>
              <ul v-if="preview.violations.length" class="violations">
                <li v-for="item in preview.violations" :key="item.code">⚠ {{ item.message }}——保留输入，暂停均价</li>
              </ul>
            </div>
            <div v-else class="preview preview-empty">输入有效的视体积、油温与视密度后显示补偿明细。</div>

            <p v-if="formError" class="form-error">{{ formError }}</p>

            <div class="actions">
              <button type="submit">{{ submitText }}</button>
              <button v-if="formMode !== 'create'" type="button" class="secondary" @click="resetForm">取消</button>
            </div>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>计量登记列表</h2>
            <select v-model="filter">
              <option>全部油品</option>
              <option v-for="fuel in fuels" :key="fuel.code" :value="fuel.name">{{ fuel.name }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filtered.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="view in filtered" :key="view.reg.id" class="record">
              <div class="record-head">
                <p class="record-title">
                  {{ view.version.fuelName }}
                  <span class="version-tag">v{{ view.version.version }}/{{ view.reg.versions.length }}</span>
                </p>
                <span class="status" :class="statusMeta(view.version).cls">{{ statusMeta(view.version).text }}</span>
              </div>

              <div class="details">
                <span>视体积 Vt：{{ fmt(view.version.observedVolume) }} L</span>
                <span>油温 t：{{ view.version.temperature }} ℃</span>
                <span>视密度 ρt：{{ fmt(view.version.observedDensity, 4) }} kg/L</span>
                <span>登记标准密度：{{ fmt(view.version.certificateDensity, 4) }} kg/L</span>
                <span>VCF：{{ fmt(view.comp?.vcf, 6) }}</span>
                <span>反算 ρ₂₀：{{ fmt(view.comp?.standardDensity, 4) }} kg/L</span>
                <span>标准升 V₂₀：<strong>{{ fmt(view.comp?.standardVolume) }} L</strong></span>
                <span>质量 m：{{ fmt(view.comp?.mass) }} kg</span>
                <span>密度核对偏差：{{ fmtSigned(certificateDelta(view.version) ?? NaN, 2) }} ‰</span>
                <span v-if="view.version.frozen">结算单价：{{ fmt(view.version.frozen.unitPrice, 2) }} 元/标准升</span>
                <span v-else>当前挂牌价：{{ fmt(findFuel(fuels, view.version.fuelName)?.listPrice ?? 0, 2) }} 元/标准升</span>
                <span v-if="view.version.frozen" class="settled">
                  结算金额：{{ fmt(view.version.frozen.amount) }} 元
                </span>
                <span v-else class="unsettled">结算金额：未复核不入均价</span>
              </div>

              <ul v-if="view.violations.length" class="violations">
                <li v-for="item in view.violations" :key="item.code">⚠ {{ item.message }}</li>
              </ul>

              <p class="note">{{ view.version.reason }}｜操作员：{{ view.version.operator }}｜{{ fmtTime(view.version.createdAt) }}</p>

              <div v-if="view.version.status === 'pending'" class="review-row">
                <label class="reviewer">
                  复核人
                  <input v-model="view.version.reviewer" placeholder="复核员" @blur="persist" />
                </label>
                <button
                  type="button"
                  :disabled="view.violations.length > 0"
                  :title="view.violations.length ? '存在越界项，不能复核确认' : '冻结标准升结算值'"
                  @click="confirmRegistration(view.reg)"
                >
                  复核确认并冻结
                </button>
              </div>

              <div class="actions">
                <button v-if="view.version.status === 'pending'" type="button" class="secondary" @click="startEdit(view.reg)">编辑</button>
                <button v-if="view.version.status === 'confirmed'" type="button" @click="startCorrect(view.reg)">更正（新版本）</button>
                <button type="button" class="secondary" @click="toggle(view.reg.id)">
                  {{ expanded[view.reg.id] ? "收起版本" : `版本明细（${view.reg.versions.length}）` }}
                </button>
                <button type="button" class="secondary" @click="copySummary(view.reg)">复制摘要</button>
                <button type="button" class="danger" @click="remove(view.reg)">删除整笔</button>
              </div>

              <div v-if="expanded[view.reg.id]" class="history">
                <div v-for="item in view.reg.versions" :key="item.version" class="history-row">
                  <span class="status sm" :class="statusMeta(item).cls">{{ statusMeta(item).text }}</span>
                  <span>v{{ item.version }}</span>
                  <span>{{ fmtTime(item.createdAt) }}</span>
                  <span>{{ item.reason }}</span>
                  <span v-if="item.frozen">
                    冻结：{{ fmt(item.frozen.standardVolume) }} 标准升 × {{ fmt(item.frozen.unitPrice, 2) }}
                    = {{ fmt(item.frozen.amount) }} 元（{{ item.frozen.confirmedBy }}，{{ fmtTime(item.frozen.frozenAt) }}）
                  </span>
                  <span v-else>未冻结</span>
                </div>
              </div>
            </article>
          </div>

          <section class="averages">
            <h3>分油品结算均价（仅已复核冻结记录，标准升加权）</h3>
            <table>
              <thead>
                <tr>
                  <th>油品</th>
                  <th>已复核标准升（L）</th>
                  <th>结算金额（元）</th>
                  <th>加权均价（元/标准升）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in averages" :key="row.name">
                  <td>{{ row.name }}</td>
                  <td>{{ fmt(row.liters) }}</td>
                  <td>{{ fmt(row.amount) }}</td>
                  <td>{{ row.avg === null ? "—" : fmt(row.avg, 4) }}</td>
                </tr>
                <tr class="total">
                  <td>综合</td>
                  <td>{{ fmt(averages.reduce((s, r) => s + r.liters, 0)) }}</td>
                  <td>{{ fmt(averages.reduce((s, r) => s + r.amount, 0)) }}</td>
                  <td>{{ overallAvg === null ? "—" : fmt(overallAvg, 4) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track">
                <div class="bar-fill" :class="row.cls" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
