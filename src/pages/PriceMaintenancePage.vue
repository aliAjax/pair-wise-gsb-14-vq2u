<script setup lang="ts">
import { computed, ref } from "vue";
import { FUEL_CATALOG } from "../domain/catalog";
import { summarizeFuel } from "../domain/settlement";
import { useOilStore } from "../store/oil-store";
import RegistrationForm from "./RegistrationForm.vue";
import RecordCard from "./RecordCard.vue";

const store = useOilStore();

const filters = ["全部油品", ...FUEL_CATALOG.map((fuel) => fuel.name)];
const filter = ref(filters[0]);
const statusFilter = ref<"全部状态" | "待复核" | "已确认" | "已暂停" | "已更正">("全部状态");

const filteredRecords = computed(() =>
  store.records.filter((record) => {
    if (filter.value !== "全部油品" && FUEL_CATALOG.find((f) => f.code === record.fuelCode)?.name !== filter.value) {
      return false;
    }
    if (statusFilter.value !== "全部状态" && record.status !== statusFilter.value) return false;
    return true;
  })
);

const metricConfirmed = computed(() => store.records.filter((r) => r.status === "已确认").length);
const metricPending = computed(
  () => store.records.filter((r) => r.status === "待复核" || r.status === "已暂停").length
);

const fuelSummaries = computed(() =>
  FUEL_CATALOG.map((fuel) => ({
    fuel,
    summary: summarizeFuel(store.records, fuel.code)
  }))
);

const chartRows = computed(() =>
  (["待复核", "已确认", "已暂停", "已更正"] as const).map((status) => ({
    status,
    value: store.records.filter((record) => record.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 计量温度补偿</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            每笔登记视体积、油温、视密度与标准密度，按 GB/T 1885 简化模型换算标准升（V20）计价；
            油温、密度或罐容越界即保留输入并暂停，复核确认后冻结结算，更正另建版本、保留旧值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">档案 / 换算 / 存储 / 页面 分离</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>登记总数</span>
          <strong>{{ store.records.length }}</strong>
        </article>
        <article class="metric">
          <span>待处理（待复核/暂停）</span>
          <strong>{{ metricPending }}</strong>
        </article>
        <article class="metric">
          <span>已确认（进均价）</span>
          <strong>{{ metricConfirmed }}</strong>
        </article>
        <article class="metric highlight">
          <span>加权均价（元/标准升）</span>
          <strong>{{ store.average.averagePrice === null ? "—" : store.average.averagePrice.toFixed(4) }}</strong>
          <small>
            样本 {{ store.average.count }} 笔 ｜ V20 合计 {{ store.average.totalStandardVolume.toLocaleString() }} 升
            ｜ 结算合计 {{ store.average.totalAmount.toLocaleString() }} 元
          </small>
        </article>
      </section>

      <section class="fuel-averages">
        <article v-for="item in fuelSummaries" :key="item.fuel.code" class="fuel-average">
          <span>{{ item.fuel.name }}</span>
          <strong>
            {{ item.summary.averagePrice === null ? "暂无均价" : `${item.summary.averagePrice.toFixed(4)} 元/升` }}
          </strong>
          <small v-if="item.summary.count > 0">{{ item.summary.count }} 笔已确认</small>
        </article>
      </section>

      <section class="workspace">
        <RegistrationForm />

        <section class="list-panel">
          <div class="toolbar">
            <h2>登记列表</h2>
            <div class="filters">
              <select v-model="filter">
                <option v-for="item in filters" :key="item">{{ item }}</option>
              </select>
              <select v-model="statusFilter">
                <option>全部状态</option>
                <option>待复核</option>
                <option>已确认</option>
                <option>已暂停</option>
                <option>已更正</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
            <RecordCard v-for="record in filteredRecords" :key="record.id" :record="record" />
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
