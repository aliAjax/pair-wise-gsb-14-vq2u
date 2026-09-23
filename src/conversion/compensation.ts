/**
 * 换算层：计量温度补偿与标准体积换算（纯函数）
 * 不依赖档案存储与页面，只依赖档案中的物性参数。
 *
 * 依据 GB/T 1885-1998《石油计量表》：
 *   标准温度 20℃；标准体积 V20 = Vt × VCF
 *   VCF（体积修正系数）在 -10℃ ~ 50℃ 区间用查表值的一阶线性近似：
 *     VCF = 1 - α × (t - 20)，汽油 α≈0.0012/℃，柴油 α≈0.0008/℃
 *   标准密度（同一温度系数）：
 *     ρ20 = ρt / [1 - α × (t - 20)] = ρt / VCF
 *   质量守恒核对：m = ρt × Vt = ρ20 × V20
 */

import type { FuelSpec } from "../archive/masterData";
import { STANDARD_TEMPERATURE, TEMPERATURE_LIMITS } from "../archive/masterData";

export interface CompensationInput {
  fuel: FuelSpec;
  /** 视体积（计量体积，L） */
  observedVolume: number;
  /** 油温（计量温度，℃） */
  temperature: number;
  /** 视密度 kg/L（计量温度下测得） */
  observedDensity: number;
}

export type ViolationCode = "TEMPERATURE_OUT_OF_RANGE" | "DENSITY_OUT_OF_RANGE" | "STANDARD_VOLUME_OVER_TANK";

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface CompensationResult {
  /** 体积修正系数 VCF（无量纲） */
  vcf: number;
  /** 标准密度 ρ20，kg/L */
  standardDensity: number;
  /** 标准体积 V20（标准升），L */
  standardVolume: number;
  /** 标准密度与档案参考密度的偏差，单位 ‰ */
  densityDeltaPermille: number;
  /** 质量 ρt×Vt，kg，用于质量守恒核对 */
  mass: number;
  violations: Violation[];
  valid: boolean;
}

/** 体积修正系数 VCF = 1 - α × (t - 20) */
export function volumeCorrectionFactor(temperature: number, alpha: number): number {
  return 1 - alpha * (temperature - STANDARD_TEMPERATURE);
}

/** 标准密度 ρ20 = ρt / VCF */
export function toStandardDensity(observedDensity: number, vcf: number): number {
  if (vcf === 0) return NaN;
  return observedDensity / vcf;
}

/** 标准体积（标准升）V20 = Vt × VCF */
export function toStandardVolume(observedVolume: number, vcf: number): number {
  return observedVolume * vcf;
}

export function evaluateCompensation(input: CompensationInput): CompensationResult {
  const { fuel, observedVolume, temperature, observedDensity } = input;
  const vcf = volumeCorrectionFactor(temperature, fuel.expansionCoefficient);
  const standardDensity = toStandardDensity(observedDensity, vcf);
  const standardVolume = toStandardVolume(observedVolume, vcf);
  const densityDeltaPermille =
    fuel.referenceDensity === 0
      ? NaN
      : ((standardDensity - fuel.referenceDensity) / fuel.referenceDensity) * 1000;
  const mass = observedDensity * observedVolume;

  const violations: Violation[] = [];
  if (temperature < TEMPERATURE_LIMITS.min || temperature > TEMPERATURE_LIMITS.max) {
    violations.push({
      code: "TEMPERATURE_OUT_OF_RANGE",
      message: `油温 ${temperature}℃ 越过允许区间 ${TEMPERATURE_LIMITS.min}℃ ~ ${TEMPERATURE_LIMITS.max}℃`
    });
  }
  if (observedDensity < fuel.minDensity || observedDensity > fuel.maxDensity) {
    violations.push({
      code: "DENSITY_OUT_OF_RANGE",
      message: `视密度 ${observedDensity} kg/L 越出 ${fuel.name} 档案范围 ${fuel.minDensity} ~ ${fuel.maxDensity} kg/L`
    });
  }
  if (standardVolume > fuel.tankCapacity) {
    violations.push({
      code: "STANDARD_VOLUME_OVER_TANK",
      message: `标准体积 ${standardVolume.toFixed(1)} L 超过罐容 ${fuel.tankCapacity} L`
    });
  }

  return {
    vcf,
    standardDensity,
    standardVolume,
    densityDeltaPermille,
    mass,
    violations,
    valid: violations.length === 0
  };
}

/** 登记输入是否可换算（数值合法）；不合法时不给出补偿明细 */
export function isMeasurable(input: { observedVolume: number; temperature: number; observedDensity: number }): boolean {
  return (
    Number.isFinite(input.observedVolume) &&
    input.observedVolume > 0 &&
    Number.isFinite(input.temperature) &&
    Number.isFinite(input.observedDensity) &&
    input.observedDensity > 0
  );
}
