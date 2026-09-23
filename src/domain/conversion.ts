import {
  GAMMA_MAX,
  GAMMA_MIN,
  STANDARD_TEMPERATURE,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  getFuelSpec
} from "./catalog";
import type { CompensationDetail, ValidationResult } from "./types";

/**
 * 换算层：GB/T 1885《石油计量表》温度补偿的确定性简化实现。
 * 全部为纯函数，不碰存储与页面，便于单独核验与测试。
 *
 * 基本关系（t 为计量温度，标准温度为 20℃；密度随温升减小）：
 *   ρt = ρ20 − γ·(t − 20)
 *   →  γ = (ρ20 − ρt) / (t − 20)        （t ≠ 20，γ 为正）
 * 按质量守恒（忽略空气浮力修正）：
 *   VCF  = ρt / ρ20                      （t > 20 时 VCF < 1）
 *   V20  = Vt × VCF
 *
 * 每一步结果都随补偿明细一并返回，页面展示“补偿明细可核”。
 */

/** 20℃ 时视密度与标准密度允许的最大差（g/cm³） */
export const DENSITY_MATCH_TOLERANCE = 0.0005;

function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** 密度温度系数 γ（g/cm³/℃）= (ρ20 − ρt)/(t − 20)；t = 20 时无温差，记 0 */
export function deriveGamma(
  observedDensity: number,
  standardDensity: number,
  temperature: number
): number {
  if (temperature === STANDARD_TEMPERATURE) return 0;
  return roundTo(
    (standardDensity - observedDensity) / (temperature - STANDARD_TEMPERATURE),
    6
  );
}

/** 体积温度修正系数 VCF = ρt/ρ20，保留 5 位小数（与密度表查表精度一致） */
export function volumeCorrectionFactor(observedDensity: number, standardDensity: number): number {
  return roundTo(observedDensity / standardDensity, 5);
}

/** 计算完整温度补偿明细 */
export function computeCompensation(input: {
  temperature: number;
  observedVolume: number;
  observedDensity: number;
  standardDensity: number;
}): CompensationDetail {
  const gamma = deriveGamma(input.observedDensity, input.standardDensity, input.temperature);
  const vcf = volumeCorrectionFactor(input.observedDensity, input.standardDensity);
  return {
    temperature: input.temperature,
    observedDensity: roundTo(input.observedDensity, 4),
    standardDensity: roundTo(input.standardDensity, 4),
    gamma,
    vcf,
    standardVolume: roundTo(input.observedVolume * vcf, 2)
  };
}

/**
 * 计量规则校验：
 * 1. 油温越过 −10℃ ~ 50℃ → 暂停
 * 2. 视密度 / 标准密度越过油品档案区间，或反算 γ 不合常理 → 暂停（密度越界）
 * 3. 标准体积超过罐容 → 暂停
 * 越界时仍返回补偿明细（能算则算），供页面保留输入并展示原因。
 */
export function validateRegistration(input: {
  fuelCode: string;
  price: number;
  observedVolume: number;
  temperature: number;
  observedDensity: number;
  standardDensity: number;
}): ValidationResult {
  const violations: string[] = [];
  const spec = getFuelSpec(input.fuelCode);
  const { temperature, observedDensity, standardDensity, observedVolume } = input;

  if (!Number.isFinite(input.price) || input.price <= 0) {
    violations.push("挂牌价必须为大于 0 的元/升");
  }

  if (!Number.isFinite(observedVolume) || observedVolume <= 0) {
    violations.push("视体积必须为大于 0 的升数");
  }

  if (
    !Number.isFinite(temperature) ||
    temperature < TEMPERATURE_MIN ||
    temperature > TEMPERATURE_MAX
  ) {
    violations.push(`油温 ${temperature}℃ 越过允许区间（${TEMPERATURE_MIN}℃ ~ ${TEMPERATURE_MAX}℃）`);
  }

  if (!Number.isFinite(observedDensity) ||
    observedDensity < spec.densityMin ||
    observedDensity > spec.densityMax
  ) {
    violations.push(
      `视密度 ${observedDensity} 越界（${spec.name}允许 ${spec.densityMin.toFixed(4)} ~ ${spec.densityMax.toFixed(4)} g/cm³）`
    );
  }

  if (!Number.isFinite(standardDensity) ||
    standardDensity < spec.densityMin ||
    standardDensity > spec.densityMax
  ) {
    violations.push(
      `标准密度 ${standardDensity} 越界（${spec.name}允许 ${spec.densityMin.toFixed(4)} ~ ${spec.densityMax.toFixed(4)} g/cm³）`
    );
  }

  const gamma = deriveGamma(observedDensity, standardDensity, temperature);
  if (
    Number.isFinite(observedDensity) &&
    Number.isFinite(standardDensity) &&
    Number.isFinite(temperature)
  ) {
    if (temperature === STANDARD_TEMPERATURE) {
      if (Math.abs(standardDensity - observedDensity) > DENSITY_MATCH_TOLERANCE) {
        violations.push(
          `油温为 20℃ 时视密度与标准密度应一致（偏差不得超过 ${DENSITY_MATCH_TOLERANCE.toFixed(4)} g/cm³）`
        );
      }
    } else if (gamma < GAMMA_MIN || gamma > GAMMA_MAX) {
      violations.push(
        `反算密度温度系数 γ=${gamma.toFixed(6)} 超出合理范围（${GAMMA_MIN} ~ ${GAMMA_MAX} g/cm³/℃），密度录数不一致`
      );
    }
  }

  const detail = computeCompensation(input);

  if (Number.isFinite(observedVolume) && observedVolume > 0 && detail.standardVolume > spec.tankCapacity) {
    violations.push(
      `标准体积 ${detail.standardVolume} 升超过罐容 ${spec.tankCapacity} 升`
    );
  }

  return { violations, detail };
}

/** 结算金额（元）= 标准升 × 挂牌价，四舍五入到分 */
export function settleAmount(standardVolume: number, price: number): number {
  return roundTo(standardVolume * price, 2);
}
