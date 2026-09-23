<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { FUEL_CATALOG } from "../domain/catalog";
import { validateRegistration } from "../domain/conversion";
import { useOilStore } from "../store/oil-store";

const store = useOilStore();

interface FormState {
  fuelCode: string;
  price: string;
  observedVolume: string;
  temperature: string;
  observedDensity: string;
  standardDensity: string;
  operator: string;
  effectiveDate: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    fuelCode: "",
    price: "",
    observedVolume: "",
    temperature: "",
    observedDensity: "",
    standardDensity: "",
    operator: "",
    effectiveDate: "",
    notes: ""
  };
}

const form = reactive<FormState>(emptyForm());
const correctionReason = ref("");
const formError = ref("");

function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/** 草稿（更正 / 就地修订）载入与退出 */
watch(
  () => store.draft,
  (draft) => {
    if (!draft) {
      Object.assign(form, emptyForm());
      correctionReason.value = "";
      formError.value = "";
      return;
    }
    const r = draft.registration;
    Object.assign(form, {
      fuelCode: r.fuelCode,
      price: String(r.price),
      observedVolume: String(r.observedVolume),
      temperature: String(r.temperature),
      observedDensity: String(r.observedDensity),
      standardDensity: String(r.standardDensity),
      operator: r.operator,
      effectiveDate: r.effectiveDate,
      notes: r.notes
    });
    correctionReason.value = draft.kind === "correction" ? draft.reason : "";
  },
  { immediate: true }
);

const parsed = computed(() => ({
  fuelCode: form.fuelCode,
  price: toNumber(form.price),
  observedVolume: toNumber(form.observedVolume),
  temperature: toNumber(form.temperature),
  observedDensity: toNumber(form.observedDensity),
  standardDensity: toNumber(form.standardDensity)
}));

const formComplete = computed(() =>
  Boolean(
    form.fuelCode &&
      Number.isFinite(parsed.value.price) &&
      Number.isFinite(parsed.value.observedVolume) &&
      Number.isFinite(parsed.value.temperature) &&
      Number.isFinite(parsed.value.observedDensity) &&
      Number.isFinite(parsed.value.standardDensity) &&
      form.operator.trim() &&
      form.effectiveDate
  )
);

/** 实时温度补偿试算：保存前即可核 γ、VCF、V20 与越界原因 */
const preview = computed(() => {
  if (!form.fuelCode) return null;
  const p = parsed.value;
  if (
    !Number.isFinite(p.observedVolume) ||
    !Number.isFinite(p.temperature) ||
    !Number.isFinite(p.observedDensity) ||
    !Number.isFinite(p.standardDensity)
  ) {
    return null;
  }
  return validateRegistration(p);
});

const previewDetail = computed(() => preview.value?.detail ?? null);

function submit() {
  formError.value = "";
  if (!formComplete.value) {
    formError.value = "请完整填写油品、数值、操作员与生效日期";
    return;
  }
  const draft = store.draft;
  if (draft?.kind === "correction" && !correctionReason.value.trim()) {
    formError.value = "更正必须填写原因，旧值将原样保留为历史版本";
    return;
  }

  const registration = {
    fuelCode: form.fuelCode,
    price: parsed.value.price,
    observedVolume: parsed.value.observedVolume,
    temperature: parsed.value.temperature,
    observedDensity: parsed.value.observedDensity,
    standardDensity: parsed.value.standardDensity,
    operator: form.operator.trim(),
    effectiveDate: form.effectiveDate,
    notes: form.notes.trim()
  };

  if (draft?.kind === "correction") {
    store.register(registration, {
      sourceId: draft.sourceId,
      reason: correctionReason.value.trim()
    });
  } else if (draft?.kind === "edit") {
    store.revise(draft.sourceId, registration);
  } else {
    store.register(registration);
  }
  Object.assign(form, emptyForm());
  correctionReason.value = "";
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>{{ store.draft?.kind === "correction" ? "更正登记（新建版本）" : "油品计量登记" }}</h2>

    <div v-if="store.draft" class="draft-banner">
      <template v-if="store.draft.kind === 'correction'">
        <strong>更正模式：</strong>
        原记录已冻结，提交后新建版本；新版本复核确认前，旧版本仍参与均价，确认后旧值转为“已更正”并保留。
      </template>
      <template v-else>
        <strong>修订模式：</strong>
        该记录尚未冻结，保存后按新录入重新校验；合格转待复核，仍越界则继续暂停。
      </template>
      <button type="button" class="secondary draft-cancel" @click="store.cancelDraft()">退出</button>
    </div>

    <div class="form-grid">
      <label>
        油品
        <select v-model="form.fuelCode" required>
          <option value="">请选择</option>
          <option v-for="fuel in FUEL_CATALOG" :key="fuel.code" :value="fuel.code">
            {{ fuel.name }}（罐容 {{ fuel.tankCapacity.toLocaleString() }} 升）
          </option>
        </select>
      </label>

      <label>
        挂牌价（元/标准升）
        <input v-model="form.price" type="number" min="0" step="0.01" required />
      </label>

      <label>
        视体积 Vt（升）
        <input v-model="form.observedVolume" type="number" min="0" step="1" required />
      </label>

      <label>
        油温 t（℃，允许 −10 ~ 50）
        <input v-model="form.temperature" type="number" step="0.1" required />
      </label>

      <label>
        视密度 ρt（g/cm³）
        <input v-model="form.observedDensity" type="number" min="0" step="0.0001" required />
      </label>

      <label>
        标准密度 ρ20（g/cm³）
        <input v-model="form.standardDensity" type="number" min="0" step="0.0001" required />
      </label>

      <label>
        操作员
        <input v-model="form.operator" type="text" required />
      </label>

      <label>
        生效日期
        <input v-model="form.effectiveDate" type="date" required />
      </label>

      <label class="full-span">
        备注
        <textarea v-model="form.notes" placeholder="处理说明或现场备注" />
      </label>

      <label v-if="store.draft?.kind === 'correction'" class="full-span">
        更正原因（必填）
        <textarea v-model="correctionReason" placeholder="例如：温度计校准偏差 1.2℃，按校准单重新登记" />
      </label>
    </div>

    <div v-if="previewDetail" class="preview" :class="{ blocked: (preview?.violations.length ?? 0) > 0 }">
      <p class="preview-title">
        温度补偿试算
        <span v-if="preview && preview.violations.length > 0" class="preview-flag">越界 · 将暂停并保留输入</span>
        <span v-else class="preview-flag ok">合格 · 登记后待复核</span>
      </p>
      <div class="preview-grid">
        <span>γ = (ρ20−ρt)/(t−20)：<strong>{{ previewDetail.gamma.toFixed(6) }}</strong> g/cm³/℃</span>
        <span>VCF = ρt/ρ20：<strong>{{ previewDetail.vcf.toFixed(5) }}</strong></span>
        <span>V20 = Vt×VCF：<strong>{{ previewDetail.standardVolume.toLocaleString() }}</strong> 标准升</span>
      </div>
      <ul v-if="preview && preview.violations.length > 0" class="violations">
        <li v-for="item in preview.violations" :key="item">{{ item }}</li>
      </ul>
    </div>

    <p v-if="formError" class="form-error">{{ formError }}</p>

    <button class="submit-btn" type="submit">
      {{ store.draft?.kind === "correction" ? "提交更正版本" : store.draft?.kind === "edit" ? "保存修订" : "登记" }}
    </button>
  </form>
</template>
