import { settleAmount, validateRegistration } from "../domain/conversion";
import { getFuelName } from "../domain/catalog";
import type { OilRecord } from "../domain/types";

/**
 * 存储层：只负责序列化、版本迁移与种子数据，
 * 不含任何业务计算（结算值由换算层函数生成，确保刷新前后一致）。
 */

export const STORAGE_KEY = "dfwlfront-9-temperature-compensation";
/** 存储结构版本：原价格维护页结构为 1，温度补偿结构为 2 */
export const STORAGE_SCHEMA_VERSION = 2;

export interface PersistShape {
  schemaVersion: number;
  savedAt: string;
  records: OilRecord[];
}

/** 由原始录入生成冻结结算快照（仅供种子数据使用） */
function seedConfirmed(
  raw: Omit<OilRecord, "id" | "status" | "violations" | "settlement" | "version" | "createdAt"> &
    Partial<Pick<OilRecord, "id" | "createdAt">>,
  id: string,
  createdAt: string
): OilRecord {
  const { violations, detail } = validateRegistration(raw);
  if (violations.length > 0 || !detail) {
    throw new Error(`种子数据 ${id} 不合法：${violations.join("；")}`);
  }
  return {
    ...raw,
    id,
    createdAt,
    version: 1,
    status: "已确认",
    violations: [],
    reviewer: raw.reviewer ?? "值班经理",
    reviewedAt: createdAt,
    settlement: {
      standardVolume: detail.standardVolume,
      price: raw.price,
      amount: settleAmount(detail.standardVolume, raw.price),
      detail,
      frozenAt: createdAt
    }
  };
}

/** 构造种子记录：一笔已确认、一笔待复核、一笔油温越界被暂停 */
export function createSeedRecords(): OilRecord[] {
  const day = 86400000;
  const now = Date.now();

  const confirmed = seedConfirmed(
    {
      fuelCode: "92",
      price: 7.62,
      observedVolume: 20000,
      temperature: 24.5,
      observedDensity: 0.7215,
      standardDensity: 0.7248,
      operator: "站长",
      effectiveDate: "2026-09-20",
      notes: "正常收货登记，已按标准升结算"
    },
    "seed-1",
    new Date(now - 2 * day).toISOString()
  );

  const pendingInput = {
    fuelCode: "0",
    price: 7.18,
    observedVolume: 18000,
    temperature: 18.2,
    observedDensity: 0.8375,
    standardDensity: 0.8362,
    operator: "值班经理",
    effectiveDate: "2026-09-22",
    notes: "等待复核"
  };
  const pendingCheck = validateRegistration(pendingInput);
  const pending: OilRecord = {
    ...pendingInput,
    id: "seed-2",
    createdAt: new Date(now - day).toISOString(),
    version: 1,
    status: "待复核",
    violations: pendingCheck.violations
  };

  // 油温 -12℃，越过 −10℃ 下限：输入保留、暂停、不进均价
  const blockedInput = {
    fuelCode: "95",
    price: 8.11,
    observedVolume: 12000,
    temperature: -12,
    observedDensity: 0.7502,
    standardDensity: 0.728,
    operator: "夜班计量员",
    effectiveDate: "2026-09-23",
    notes: "低温收货，温度计疑似故障，待现场核对"
  };
  const blockedCheck = validateRegistration(blockedInput);
  const blocked: OilRecord = {
    ...blockedInput,
    id: "seed-3",
    createdAt: new Date(now - 2 * 3600000).toISOString(),
    version: 1,
    status: blockedCheck.violations.length > 0 ? "已暂停" : "待复核",
    violations: blockedCheck.violations
  };

  return [blocked, pending, confirmed];
}

function isValidShape(value: unknown): value is PersistShape {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as PersistShape).records)
  );
}

/** 读取：结构不认识（含旧版价格页数据）时回退到种子数据，不做静默混用 */
export function loadRecords(): OilRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createSeedRecords();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidShape(parsed)) return createSeedRecords();
    if (parsed.schemaVersion !== STORAGE_SCHEMA_VERSION) {
      // 旧版本结构不兼容：迁移策略后续在这里扩展，当前回退种子
      return createSeedRecords();
    }
    return parsed.records;
  } catch {
    return createSeedRecords();
  }
}

/** 写入：刷新后温度、标准升结算、均价与版本都从同一快照恢复 */
export function saveRecords(records: OilRecord[]): void {
  const payload: PersistShape = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    records
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function fuelDisplayName(code: string): string {
  return getFuelName(code);
}
