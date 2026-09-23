/**
 * 存储层：油品档案与计量登记的本地持久化（localStorage）
 * 与页面框架无关：纯数据结构 + 读写函数，不引入 Vue。
 * 刷新后温度、标准升结算、均价与版本保持一致，依赖确认时冻结的快照。
 */

import { cloneDefaultFuels, type FuelSpec } from "../archive/masterData";
import { evaluateCompensation } from "../conversion/compensation";

export const FUELS_STORAGE_KEY = "dfwlfront-9-fuels-v2";
export const REGISTRATIONS_STORAGE_KEY = "dfwlfront-9-registrations-v2";
/** 旧版挂牌价页数据保留，不删除 */
export const LEGACY_PRICE_STORAGE_KEY = "dfwlfront-9-price";

/** 确认时冻结的结算值；确认后不可变，更正只生成新版本 */
export interface FrozenSettlement {
  /** 冻结时刻的挂牌价 元/升 */
  unitPrice: number;
  /** 结算金额（标准升 × 挂牌价），元 */
  amount: number;
  /** 冻结时使用的标准升，L */
  standardVolume: number;
  /** 冻结时使用的 VCF */
  vcf: number;
  /** 冻结时使用的标准密度，kg/L */
  standardDensity: number;
  /** 冻结时的质量，kg */
  mass: number;
  /** 冻结时间 ISO 字符串 */
  frozenAt: string;
  /** 复核人 */
  confirmedBy: string;
}

export type VersionStatus = "pending" | "confirmed" | "superseded";

/** 一笔登记的一个原因版本 */
export interface RegistrationVersion {
  version: number;
  status: VersionStatus;
  /** 计量温度补偿输入快照 */
  fuelName: string;
  observedVolume: number;
  temperature: number;
  observedDensity: number;
  /** 登记的标准密度（随批化验单/证书），与补偿反算的 ρ20 核对 */
  certificateDensity: number;
  /** 补偿反算的标准密度，冻结值以 frozen 为准 */
  standardDensity: number;
  vcf: number;
  standardVolume: number;
  /** 版本原因：首次登记 / 更正原因 */
  reason: string;
  operator: string;
  reviewer: string;
  createdAt: string;
  /** 仅 confirmed 版本存在；存在即代表结算已冻结 */
  frozen?: FrozenSettlement;
}

export interface Registration {
  id: string;
  /** 当前版本号（最新版本不一定已复核） */
  currentVersion: number;
  versions: RegistrationVersion[];
}

export interface PersistedState {
  fuels: FuelSpec[];
  registrations: Registration[];
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadFuels(): FuelSpec[] {
  const raw = localStorage.getItem(FUELS_STORAGE_KEY);
  if (!raw) return cloneDefaultFuels();
  try {
    const parsed = JSON.parse(raw) as FuelSpec[];
    if (!Array.isArray(parsed) || parsed.length === 0) return cloneDefaultFuels();
    // 以档案代码为准补齐后续新增字段，保持向前兼容
    return cloneDefaultFuels().map((base) => {
      const saved = parsed.find((item) => item.code === base.code);
      return saved ? { ...base, ...saved } : base;
    });
  } catch {
    return cloneDefaultFuels();
  }
}

function buildSeedRegistrations(fuels: FuelSpec[]): Registration[] {
  const now = Date.now();
  const day = 86400000;

  const makeVersion = (
    partial: Omit<RegistrationVersion, "standardDensity" | "vcf" | "standardVolume">,
    fuels: FuelSpec[]
  ): RegistrationVersion => {
    const fuel = fuels.find((item) => item.name === partial.fuelName)!;
    const result = evaluateCompensation({
      fuel,
      observedVolume: partial.observedVolume,
      temperature: partial.temperature,
      observedDensity: partial.observedDensity
    });
    return {
      ...partial,
      standardDensity: Number(result.standardDensity.toFixed(4)),
      vcf: Number(result.vcf.toFixed(6)),
      standardVolume: Number(result.standardVolume.toFixed(2))
    };
  };

  const withFrozen = (version: RegistrationVersion, fuels: FuelSpec[]): RegistrationVersion => {
    const fuel = fuels.find((item) => item.name === version.fuelName)!;
    const amount = version.standardVolume * fuel.listPrice;
    return {
      ...version,
      frozen: {
        unitPrice: fuel.listPrice,
        amount: Number(amount.toFixed(2)),
        standardVolume: version.standardVolume,
        vcf: version.vcf,
        standardDensity: version.standardDensity,
        mass: Number((version.observedDensity * version.observedVolume).toFixed(2)),
        frozenAt: version.createdAt,
        confirmedBy: version.reviewer || "复核员"
      }
    };
  };

  const seedV1 = withFrozen(
    makeVersion(
      {
        version: 1,
        status: "confirmed",
        fuelName: "92号汽油",
        observedVolume: 10000,
        temperature: 24.5,
        observedDensity: 0.741,
        certificateDensity: 0.745,
        reason: "首次登记",
        operator: "站长",
        reviewer: "复核员",
        createdAt: new Date(now - 3 * day).toISOString()
      },
      fuels
    ),
    fuels
  );

  // 同一笔登记：已冻结的旧版本 + 待复核的更正版本
  const oldVersion = withFrozen(
    makeVersion(
      {
        version: 1,
        status: "superseded",
        fuelName: "98号汽油",
        observedVolume: 8000,
        temperature: 18,
        observedDensity: 0.752,
        certificateDensity: 0.75,
        reason: "首次登记",
        operator: "值班经理",
        reviewer: "复核员",
        createdAt: new Date(now - 2 * day).toISOString()
      },
      fuels
    ),
    fuels
  );
  const corrected = makeVersion(
    {
      version: 2,
      status: "pending",
      fuelName: "98号汽油",
      observedVolume: 8200,
      temperature: 18,
      observedDensity: 0.752,
      certificateDensity: 0.75,
      reason: "更正：视体积录入错误，按发油单修正",
      operator: "值班经理",
      reviewer: "",
      createdAt: new Date(now - day).toISOString()
    },
    fuels
  );

  return [
    {
      id: "seed-r1",
      currentVersion: 1,
      versions: [seedV1]
    },
    {
      id: "seed-r2",
      currentVersion: 2,
      versions: [oldVersion, corrected]
    },
    {
      id: "seed-r3",
      currentVersion: 1,
      versions: [
        makeVersion(
          {
            version: 1,
            status: "pending",
            fuelName: "柴油",
            observedVolume: 12000,
            temperature: 6,
            observedDensity: 0.84,
            certificateDensity: 0.835,
            reason: "首次登记",
            operator: "值班经理",
            reviewer: "",
            createdAt: new Date(now - 6 * 3600000).toISOString()
          },
          fuels
        )
      ]
    },
    {
      id: "seed-r4",
      currentVersion: 1,
      versions: [
        makeVersion(
          {
            version: 1,
            status: "pending",
            fuelName: "95号汽油",
            observedVolume: 32000,
            temperature: 25,
            observedDensity: 0.743,
            certificateDensity: 0.747,
            reason: "首次登记",
            operator: "站长",
            reviewer: "",
            createdAt: new Date(now - 2 * 3600000).toISOString()
          },
          fuels
        )
      ]
    }
  ];
}

function loadRegistrations(fuels: FuelSpec[]): Registration[] {
  const raw = localStorage.getItem(REGISTRATIONS_STORAGE_KEY);
  if (!raw) return buildSeedRegistrations(fuels);
  try {
    const parsed = JSON.parse(raw) as Registration[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadState(): PersistedState {
  const fuels = loadFuels();
  return { fuels, registrations: loadRegistrations(fuels) };
}

export function saveFuels(fuels: FuelSpec[]): void {
  localStorage.setItem(FUELS_STORAGE_KEY, JSON.stringify(fuels));
}

export function saveRegistrations(registrations: Registration[]): void {
  localStorage.setItem(REGISTRATIONS_STORAGE_KEY, JSON.stringify(registrations));
}

export function makeId(): string {
  return uid();
}
