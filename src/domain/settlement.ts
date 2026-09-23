import { settleAmount, validateRegistration } from "./conversion";
import type { OilRecord, Registration } from "./types";

/**
 * 结算口径（纯函数集合）：
 * 只有“已确认”记录进入均价；待复核、已暂停、已更正一律剔除。
 * 均价按标准升加权（结算金额合计 ÷ 标准升合计），单位：元/标准升。
 */

export function entersAveragePrice(record: OilRecord): boolean {
  return record.status === "已确认" && !!record.settlement;
}

export interface AveragePriceResult {
  /** 参与均价计算的记录数 */
  count: number;
  /** 标准升合计 */
  totalStandardVolume: number;
  /** 结算金额合计 */
  totalAmount: number;
  /** 加权均价（元/标准升）；无样本时为 null */
  averagePrice: number | null;
}

export function summarizeForAverage(records: readonly OilRecord[]): AveragePriceResult {
  const effective = records.filter(entersAveragePrice);
  const totalStandardVolume = effective.reduce(
    (sum, record) => sum + (record.settlement?.standardVolume ?? 0),
    0
  );
  const totalAmount = effective.reduce(
    (sum, record) => sum + (record.settlement?.amount ?? 0),
    0
  );
  return {
    count: effective.length,
    totalStandardVolume: Number(totalStandardVolume.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
    averagePrice: totalStandardVolume > 0 ? Number((totalAmount / totalStandardVolume).toFixed(4)) : null
  };
}

/** 按油品过滤后再汇总，供页面分油品展示 */
export function summarizeFuel(records: readonly OilRecord[], fuelCode: string): AveragePriceResult {
  return summarizeForAverage(records.filter((record) => record.fuelCode === fuelCode));
}

/**
 * 冻结结算值：确认动作唯一入口。
 * 以记录当前录入重算补偿明细，落盘结算快照；此后修改录入不影响该快照。
 */
export function freezeSettlement(record: OilRecord, reviewer: string): OilRecord {
  const result = validateRegistration(record);
  if (result.violations.length > 0 || !result.detail) {
    throw new Error("存在计量越界，不能复核确认");
  }
  const amount = settleAmount(result.detail.standardVolume, record.price);
  return {
    ...record,
    status: "已确认",
    violations: [],
    reviewer,
    reviewedAt: new Date().toISOString(),
    settlement: {
      standardVolume: result.detail.standardVolume,
      price: record.price,
      amount,
      detail: result.detail,
      frozenAt: new Date().toISOString()
    }
  };
}

/** 从录入构造一条待复核/已暂停的新版本记录（尚未冻结） */
export function buildRecord(
  registration: Registration,
  options: {
    id: string;
    createdAt: string;
    version: number;
    supersedesId?: string;
  }
): OilRecord {
  const { violations } = validateRegistration(registration);
  return {
    ...registration,
    id: options.id,
    createdAt: options.createdAt,
    version: options.version,
    supersedesId: options.supersedesId,
    status: violations.length > 0 ? "已暂停" : "待复核",
    violations
  };
}
