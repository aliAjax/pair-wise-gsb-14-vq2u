<script setup lang="ts">
import { getFuelSpec } from "../domain/catalog";
import { useOilStore } from "../store/oil-store";
import type { OilRecord } from "../domain/types";

const props = defineProps<{ record: OilRecord }>();
const store = useOilStore();

const fuel = getFuelSpec(props.record.fuelCode);

function confirmRecord() {
  const reviewer = window.prompt("复核确认：请输入复核人姓名", "值班经理");
  if (!reviewer) return;
  try {
    store.confirm(props.record.id, reviewer.trim());
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function copySummary() {
  const r = props.record;
  const settlement = r.settlement
    ? `；V20=${r.settlement.standardVolume}升；结算${r.settlement.amount}元`
    : "";
  window.navigator.clipboard?.writeText(
    `${fuel.name} v${r.version} / ${r.status} / 油温${r.temperature}℃${settlement}`
  );
}

const statusClass: Record<string, string> = {
  待复核: "st-pending",
  已确认: "st-confirmed",
  已暂停: "st-blocked",
  已更正: "st-superseded"
};

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
</script>

<template>
  <article class="record" :class="{ blocked: record.status === '已暂停', superseded: record.status === '已更正' }">
    <div class="record-head">
      <p class="record-title">
        {{ fuel.name }}
        <span class="version">v{{ record.version }}</span>
      </p>
      <span class="status" :class="statusClass[record.status]">{{ record.status }}</span>
    </div>

    <div class="details">
      <span>挂牌价：{{ record.price.toFixed(2) }} 元/标准升</span>
      <span>油温：{{ record.temperature }}℃</span>
      <span>视体积 Vt：{{ record.observedVolume.toLocaleString() }} 升</span>
      <span>视密度 ρt：{{ record.observedDensity.toFixed(4) }} g/cm³</span>
      <span>标准密度 ρ20：{{ record.standardDensity.toFixed(4) }} g/cm³</span>
      <span>罐容：{{ fuel.tankCapacity.toLocaleString() }} 升</span>
      <span>操作员：{{ record.operator }}</span>
      <span>生效日期：{{ record.effectiveDate }}</span>
    </div>

    <ul v-if="record.violations.length > 0" class="violations">
      <li v-for="item in record.violations" :key="item">{{ item }}</li>
    </ul>

    <!-- 冻结结算值：确认后不可改写；未确认记录不展示结算、不进均价 -->
    <section v-if="record.settlement" class="settlement">
      <p class="settlement-title">标准升结算（已冻结于 {{ formatTime(record.settlement.frozenAt) }}）</p>
      <div class="settlement-grid">
        <span>γ：<strong>{{ record.settlement.detail.gamma.toFixed(6) }}</strong></span>
        <span>VCF：<strong>{{ record.settlement.detail.vcf.toFixed(5) }}</strong></span>
        <span>标准升 V20：<strong>{{ record.settlement.standardVolume.toLocaleString() }}</strong></span>
        <span>结算单价：<strong>{{ record.settlement.price.toFixed(2) }}</strong> 元/升</span>
        <span class="amount">结算金额：<strong>{{ record.settlement.amount.toLocaleString() }}</strong> 元</span>
      </div>
      <p class="comp-line">
        补偿明细：γ = ({{ record.settlement.detail.standardDensity.toFixed(4) }}
        − {{ record.settlement.detail.observedDensity.toFixed(4) }})
        / ({{ record.settlement.detail.temperature }} − 20)
        = {{ record.settlement.detail.gamma.toFixed(6) }}；
        VCF = {{ record.settlement.detail.observedDensity.toFixed(4) }}
        / {{ record.settlement.detail.standardDensity.toFixed(4) }}
        = {{ record.settlement.detail.vcf.toFixed(5) }}；
        V20 = {{ record.observedVolume.toLocaleString() }} × {{ record.settlement.detail.vcf.toFixed(5) }}
        = {{ record.settlement.standardVolume.toLocaleString() }} 升
      </p>
      <p v-if="record.reviewer" class="review-line">复核人：{{ record.reviewer }} ｜ 复核时间：{{ formatTime(record.reviewedAt ?? "") }}</p>
    </section>

    <p v-if="record.correctionReason" class="correction-line">
      更正原因：{{ record.correctionReason }}
    </p>
    <p v-else-if="record.supersedesId" class="correction-line">本版本取代上一版本（旧值已保留）</p>

    <p class="note">{{ record.notes }}</p>

    <div class="actions">
      <button v-if="record.status === '待复核'" type="button" @click="confirmRecord">复核确认</button>
      <button v-if="record.status === '已暂停'" type="button" @click="store.startEdit(record.id)">修订重验</button>
      <button v-if="record.status === '已确认'" type="button" @click="store.startCorrection(record.id)">更正（新建版本）</button>
      <button class="secondary" type="button" @click="copySummary">复制摘要</button>
      <button class="danger" type="button" @click="store.remove(record.id)">删除</button>
    </div>
  </article>
</template>
