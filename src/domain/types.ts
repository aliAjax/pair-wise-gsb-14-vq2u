/**
 * 计量温度补偿领域类型
 * 仅描述业务概念，不依赖 Vue、存储或页面层。
 */

/** 记录生命周期状态 */
export type RecordStatus = "待复核" | "已确认" | "已暂停" | "已更正";

/** 单条登记的原始录入 */
export interface Registration {
  /** 油品编码 */
  fuelCode: string;
  /** 挂牌价（元/标准升，结算用） */
  price: number;
  /** 视体积 Vt（升，计量温度下测得的体积） */
  observedVolume: number;
  /** 油温 t（℃，计量温度） */
  temperature: number;
  /** 视密度 ρt（g/cm³，计量温度下测得的密度） */
  observedDensity: number;
  /** 标准密度 ρ20（g/cm³，20℃ 标准密度） */
  standardDensity: number;
  /** 操作员 */
  operator: string;
  /** 生效日期 */
  effectiveDate: string;
  /** 备注 */
  notes: string;
}

/** 温度补偿换算明细（GB/T 1885 简化模型，每一步可核） */
export interface CompensationDetail {
  /** 计量温度 t（℃） */
  temperature: number;
  /** 视密度 ρt（g/cm³） */
  observedDensity: number;
  /** 标准密度 ρ20（g/cm³） */
  standardDensity: number;
  /** 由 ρt、ρ20 反算的密度温度系数 γ（g/cm³/℃） */
  gamma: number;
  /** 体积温度修正系数 VCF = 1 + γ·(20 − t) */
  vcf: number;
  /** 标准体积 V20 = Vt × VCF（升） */
  standardVolume: number;
}

/** 冻结的结算值：确认后不再随录入变化 */
export interface SettlementSnapshot {
  /** 标准升 V20（升） */
  standardVolume: number;
  /** 结算单价（元/标准升，确认时的挂牌价） */
  price: number;
  /** 结算金额（元）= 标准升 × 单价 */
  amount: number;
  /** 完整补偿明细，用于核验 */
  detail: CompensationDetail;
  /** 冻结时间 */
  frozenAt: string;
}

/** 一条油品登记记录 */
export interface OilRecord extends Registration {
  id: string;
  status: RecordStatus;
  createdAt: string;
  /** 同一笔业务的版本号，从 1 开始，更正时递增 */
  version: number;
  /** 上一版本记录 id（仅更正版本存在） */
  supersedesId?: string;
  /** 更正原因（仅更正版本存在） */
  correctionReason?: string;
  /** 暂停原因（校验越界时保留） */
  violations: string[];
  /** 确认后冻结的结算值 */
  settlement?: SettlementSnapshot;
  /** 复核人 */
  reviewer?: string;
  /** 复核时间 */
  reviewedAt?: string;
}

/** 油品档案（档案层维护，页面与换算共同引用） */
export interface FuelSpec {
  code: string;
  name: string;
  /** 密度合法区间（g/cm³），视密度与标准密度均须落在此区间 */
  densityMin: number;
  densityMax: number;
  /** 罐容（升），标准体积 V20 不得超过 */
  tankCapacity: number;
}

/** 校验结果 */
export interface ValidationResult {
  violations: string[];
  detail: CompensationDetail | null;
}
