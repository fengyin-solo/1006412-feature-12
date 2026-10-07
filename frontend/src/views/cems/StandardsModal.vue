<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <section class="modal">
      <header class="modal-head">
        <h3>排放限值标准</h3>
        <button class="btn ghost" type="button" @click="$emit('close')">关闭</button>
      </header>

      <p class="modal-hint">
        限值仅由「环保管理岗」调整。保存后：已采集未审定的记录按新限值重算超标预警并保留前后差异；
        待采集记录同步新限值；已审定记录维持当时结论不变。
      </p>

      <table class="data-table">
        <thead>
          <tr><th>监测因子</th><th>现行限值</th><th>新限值</th><th>最近更新</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in standards" :key="item.因子">
            <td>{{ item.因子 }}</td>
            <td>{{ item.限值 }} {{ item.单位 }}</td>
            <td>
              <input
                class="limit-input"
                type="number"
                step="0.1"
                :value="drafts[item.因子] ?? item.限值"
                :disabled="!canAdjust"
                @input="setDraft(item.因子, ($event.target as HTMLInputElement).value)"
              />
              {{ item.单位 }}
            </td>
            <td>{{ item.更新时间 }} · {{ item.更新人 }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="!canAdjust" class="modal-hint warn">当前岗位「{{ ctx.post }}」无权维护限值，调整动作会被打回并留痕。</p>

      <footer class="modal-foot">
        <button
          v-for="item in changed"
          :key="item.因子"
          class="btn primary"
          type="button"
          @click="$emit('adjust', item.因子, item.限值)"
        >
          调整「{{ item.因子 }}」为 {{ item.限值 }}
        </button>
        <button class="btn ghost" type="button" @click="$emit('close')">关闭</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { ENV_POST } from '@/data/cems/constants'
import type { OperatorContext, StandardRow } from '@/data/cems/types'

const props = defineProps<{
  open: boolean
  standards: StandardRow[]
  ctx: OperatorContext
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'adjust', factor: string, limit: number): void
}>()

const drafts = reactive<Record<string, number>>({})

watch(
  () => props.standards,
  (rows) => {
    for (const row of rows) {
      if (!(row.因子 in drafts)) {
        drafts[row.因子] = row.限值
      }
    }
  },
  { immediate: true, deep: true },
)

function setDraft(factor: string, value: string) {
  drafts[factor] = Number(value)
}

const canAdjust = computed(() => props.ctx.post === ENV_POST)

const changed = computed(() =>
  props.standards
    .map((item) => ({ 因子: item.因子, 限值: drafts[item.因子] ?? item.限值 }))
    .filter((item) => Number(item.限值) > 0 && item.限值 !== currentOf(item.因子)),
)

function currentOf(factor: string): number {
  return props.standards.find((item) => item.因子 === factor)?.限值 ?? NaN
}
</script>
