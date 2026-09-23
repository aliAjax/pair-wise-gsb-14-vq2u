import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { loadRecords, saveRecords } from "../storage/records-store";
import { validateRegistration } from "../domain/conversion";
import { buildRecord, freezeSettlement, summarizeForAverage } from "../domain/settlement";
import type { OilRecord, RecordStatus, Registration } from "../domain/types";

/**
 * 状态层（Pinia）：组织登记、复核、更正的用例编排；
 * 计算规则在换算层、持久化在存储层，这里不重复实现。
 */

/** 编辑草稿：已确认记录走“更正”（新建版本），其余走“就地修订”（重算校验） */
export type Draft =
  | { kind: "correction"; sourceId: string; reason: string; registration: Registration }
  | { kind: "edit"; sourceId: string; registration: Registration };

function toRegistration(source: OilRecord): Registration {
  const {
    fuelCode,
    price,
    observedVolume,
    temperature,
    observedDensity,
    standardDensity,
    operator,
    effectiveDate,
    notes
  } = source;
  return {
    fuelCode,
    price,
    observedVolume,
    temperature,
    observedDensity,
    standardDensity,
    operator,
    effectiveDate,
    notes
  };
}

export const useOilStore = defineStore("oil-temperature-compensation", () => {
  const records = ref<OilRecord[]>(loadRecords());
  const draft = ref<Draft | null>(null);

  const average = computed(() => summarizeForAverage(records.value));

  function persist() {
    saveRecords(records.value);
  }

  /**
   * 登记一笔：
   * - 无越界 → 待复核，不进均价
   * - 有越界 → 已暂停，输入全部保留，等待修订
   * - 更正已确认记录 → 版本号 = 旧版本 + 1，确认后旧值转为“已更正”并保留
   */
  function register(registration: Registration, correction?: { sourceId: string; reason: string }) {
    const now = new Date().toISOString();
    let version = 1;
    if (correction) {
      const source = records.value.find((record) => record.id === correction.sourceId);
      if (!source) throw new Error("找不到被更正的记录");
      if (source.status !== "已确认") throw new Error("只能更正已确认并冻结的记录");
      version = source.version + 1;
    }

    const record = buildRecord(registration, {
      id: crypto.randomUUID(),
      createdAt: now,
      version,
      supersedesId: correction?.sourceId
    });
    const withReason: OilRecord = correction
      ? { ...record, correctionReason: correction.reason }
      : record;

    records.value = [withReason, ...records.value];
    draft.value = null;
    persist();
    return withReason;
  }

  /**
   * 就地修订未冻结记录（待复核 / 已暂停）：原 id、创建时间与版本保留，
   * 按新录入重新校验并决定状态；暂停记录修订合格后回到待复核。
   */
  function revise(id: string, registration: Registration) {
    const index = records.value.findIndex((record) => record.id === id);
    if (index < 0) return;
    const source = records.value[index];
    if (source.status === "已确认") {
      throw new Error("已确认记录已冻结，请走“更正”新建版本");
    }
    const { violations } = validateRegistration(registration);
    const nextStatus: RecordStatus = violations.length > 0 ? "已暂停" : "待复核";
    records.value[index] = {
      ...source,
      ...registration,
      status: nextStatus,
      violations
    };
    draft.value = null;
    persist();
  }

  /**
   * 复核确认：仅无越界的待复核记录可执行。
   * 确认瞬间冻结标准升、单价、金额与补偿明细。
   * 若是更正版本，被取代的旧记录同步转为“已更正”（旧结算值原样保留）。
   */
  function confirm(id: string, reviewer: string) {
    const index = records.value.findIndex((record) => record.id === id);
    if (index < 0) return;
    const target = records.value[index];
    if (target.status !== "待复核") {
      throw new Error("仅待复核记录可以复核确认");
    }

    const confirmed = freezeSettlement(target, reviewer);
    records.value = records.value.map((record) => {
      if (record.id === id) return confirmed;
      if (confirmed.supersedesId && record.id === confirmed.supersedesId) {
        return { ...record, status: "已更正" as RecordStatus };
      }
      return record;
    });
    persist();
  }

  /** 发起更正：冻结值不改写，旧值带入登记表，必须填写原因，另建版本 */
  function startCorrection(id: string) {
    const source = records.value.find((record) => record.id === id);
    if (!source || source.status !== "已确认") return;
    draft.value = {
      kind: "correction",
      sourceId: source.id,
      reason: "",
      registration: toRegistration(source)
    };
  }

  /** 载入未冻结记录进行就地修订 */
  function startEdit(id: string) {
    const source = records.value.find((record) => record.id === id);
    if (!source || source.status === "已确认" || source.status === "已更正") return;
    draft.value = { kind: "edit", sourceId: source.id, registration: toRegistration(source) };
  }

  function cancelDraft() {
    draft.value = null;
  }

  function remove(id: string) {
    records.value = records.value.filter((record) => record.id !== id);
    if (draft.value?.sourceId === id) draft.value = null;
    persist();
  }

  return {
    records,
    draft,
    average,
    register,
    revise,
    confirm,
    startCorrection,
    startEdit,
    cancelDraft,
    remove
  };
});
