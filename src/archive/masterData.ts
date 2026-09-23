/**
 * 档案层：油品基础档案与计量边界常量
 * 仅提供静态档案数据，不依赖换算、存储与页面。
 */

/** 标准温度（GB/T 1885，20℃） */
export const STANDARD_TEMPERATURE = 20;

/** 允许登记的油温区间：-10℃ ~ 50℃（越过即异常，保留输入并暂停均价） */
export const TEMPERATURE_LIMITS = {
  min: -10,
  max: 50
} as const;

export interface FuelSpec {
  code: string;
  /** 油品名称 */
  name: string;
  /** 视密度允许下限 kg/L（越界即异常） */
  minDensity: number;
  /** 视密度允许上限 kg/L */
  maxDensity: number;
  /** 参考标准密度 ρ20 kg/L，用于补偿明细核对 */
  referenceDensity: number;
  /** 罐容 L（标准体积超过罐容即异常） */
  tankCapacity: number;
  /**
   * 体积温度补偿系数 α（1/℃）
   * VCF = 1 - α × (油温 - 20℃)，GB/T 1885-1998 查表值在 -10~50℃ 内的一阶近似：
   * 汽油约 0.0012/℃，柴油约 0.0008/℃
   */
  expansionCoefficient: number;
  /** 当前挂牌价 元/升（结算按标准升计价，确认时随结算一并冻结） */
  listPrice: number;
}

export const DEFAULT_FUELS: FuelSpec[] = [
  {
    code: "92",
    name: "92号汽油",
    minDensity: 0.72,
    maxDensity: 0.775,
    referenceDensity: 0.745,
    tankCapacity: 30000,
    expansionCoefficient: 0.0012,
    listPrice: 7.62
  },
  {
    code: "95",
    name: "95号汽油",
    minDensity: 0.725,
    maxDensity: 0.775,
    referenceDensity: 0.747,
    tankCapacity: 30000,
    expansionCoefficient: 0.0012,
    listPrice: 8.1
  },
  {
    code: "98",
    name: "98号汽油",
    minDensity: 0.73,
    maxDensity: 0.78,
    referenceDensity: 0.75,
    tankCapacity: 30000,
    expansionCoefficient: 0.0012,
    listPrice: 9.05
  },
  {
    code: "D0",
    name: "柴油",
    minDensity: 0.81,
    maxDensity: 0.855,
    referenceDensity: 0.835,
    tankCapacity: 30000,
    expansionCoefficient: 0.0008,
    listPrice: 7.18
  }
];

export function cloneDefaultFuels(): FuelSpec[] {
  return DEFAULT_FUELS.map((fuel) => ({ ...fuel }));
}

export function findFuel(fuels: FuelSpec[], name: string): FuelSpec | undefined {
  return fuels.find((fuel) => fuel.name === name);
}
