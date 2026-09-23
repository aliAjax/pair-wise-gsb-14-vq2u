import type { FuelSpec } from "./types";

/**
 * 档案层：油品档案与计量边界。
 * 与换算、存储、页面解耦；调整罐容或密度区间只改这里。
 */

/** 计量温度允许区间（含端点）：零下十度至五十度 */
export const TEMPERATURE_MIN = -10;
export const TEMPERATURE_MAX = 50;

/** 标准温度 20℃ */
export const STANDARD_TEMPERATURE = 20;

/**
 * 由视密度、标准密度反算的密度温度系数允许区间（g/cm³/℃）。
 * 石油产品约为 0.0004 ~ 0.0015，用于识别“密度越界 / 录数打架”。
 */
export const GAMMA_MIN = 0.0004;
export const GAMMA_MAX = 0.0015;

/** 油品档案表 */
export const FUEL_CATALOG: readonly FuelSpec[] = [
  { code: "92", name: "92号汽油", densityMin: 0.7000, densityMax: 0.7800, tankCapacity: 30000 },
  { code: "95", name: "95号汽油", densityMin: 0.7100, densityMax: 0.7900, tankCapacity: 30000 },
  { code: "98", name: "98号汽油", densityMin: 0.7200, densityMax: 0.8000, tankCapacity: 20000 },
  { code: "0", name: "柴油", densityMin: 0.8100, densityMax: 0.8700, tankCapacity: 40000 }
];

const FUEL_BY_CODE = new Map(FUEL_CATALOG.map((fuel) => [fuel.code, fuel]));

export function getFuelSpec(code: string): FuelSpec {
  const spec = FUEL_BY_CODE.get(code);
  if (!spec) throw new Error(`未知油品编码：${code}`);
  return spec;
}

export function getFuelName(code: string): string {
  return getFuelSpec(code).name;
}
