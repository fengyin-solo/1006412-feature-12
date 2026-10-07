<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <section class="modal">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="btn ghost" type="button" @click="$emit('close')">关闭</button>
      </header>

      <p v-if="hint" class="modal-hint" :class="{ warn: !editable }">{{ hint }}</p>

      <form class="modal-form" @submit.prevent="submit">
        <label class="form-item">
          <span>监测编号 <em>*</em></span>
          <input v-model="form.监测编号" :disabled="mode !== 'register'" placeholder="如 CEMS-2026-0907-01" />
        </label>
        <label class="form-item">
          <span>监测因子 <em>*</em></span>
          <select v-model="form.监测因子" :disabled="mode !== 'register'">
            <option value="" disabled>请选择</option>
            <option v-for="item in standards" :key="item.因子" :value="item.因子">
              {{ item.因子 }}（限值 {{ item.限值 }} {{ item.单位 }}）
            </option>
          </select>
        </label>
        <label class="form-item">
          <span>采集设备 <em>*</em></span>
          <select v-model="form.采集设备" :disabled="mode !== 'register'">
            <option value="" disabled>请选择</option>
            <option v-for="device in devices" :key="device.code" :value="device.code">
              {{ device.code }} {{ device.name }}（{{ device.post }}）
            </option>
          </select>
        </label>
        <label class="form-item readonly">
          <span>归属岗位（由设备决定）</span>
          <input :value="ownerPost" disabled />
        </label>
        <label class="form-item readonly">
          <span>排放限值（固化，走限值标准调整）</span>
          <input :value="limitHint" disabled />
        </label>
        <label class="form-item">
          <span>实测值（mg/m³）</span>
          <input v-model="form.实测值" :disabled="valueDisabled" placeholder="待采集可留空，采集时必填数值" />
        </label>
        <label class="form-item">
          <span>折算值（mg/m³）</span>
          <input v-model="form.折算值" :disabled="!editable" />
        </label>
        <label class="form-item">
          <span>采集时间</span>
          <input v-model="form.采集时间" type="datetime-local" :disabled="!editable" />
        </label>

        <footer class="modal-foot">
          <button class="btn primary" type="submit" :disabled="!editable">
            {{ mode === 'register' ? '登记' : mode === 'collect' ? '提交采集' : '保存修改' }}
          </button>
          <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { CEMS_DEVICES, postOfDevice } from '@/data/cems/constants'
import type { CemsRow, OperatorContext, RegisterInput, StandardRow } from '@/data/cems/types'

const props = defineProps<{
  open: boolean
  mode: 'register' | 'collect' | 'edit'
  row: CemsRow | null
  ctx: OperatorContext
  standards: StandardRow[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', payload: RegisterInput): void
}>()

const devices = CEMS_DEVICES

function toLocalInput(text: string): string {
  // 「2026-09-01 08:00」→「2026-09-01T08:00」
  return text.replace(' ', 'T')
}

function blankForm(): RegisterInput {
  return {
    监测编号: '',
    监测因子: '',
    采集设备: '',
    实测值: '',
    折算值: '',
    采集时间: '',
  }
}

const form = reactive<RegisterInput>(blankForm())

watch(
  () => [props.open, props.row] as const,
  () => {
    if (!props.open) {
      return
    }
    if (props.mode === 'register' || !props.row) {
      Object.assign(form, blankForm())
      return
    }
    form.监测编号 = props.row.监测编号
    form.监测因子 = props.row.监测因子
    form.采集设备 = props.row.采集设备
    form.实测值 = props.row.实测值
    form.折算值 = props.row.折算值
    form.采集时间 = toLocalInput(props.row.采集时间)
  },
  { immediate: true },
)

const title = computed(() => {
  if (props.mode === 'register') {
    return '登记排放监测记录'
  }
  if (props.mode === 'collect') {
    return `提交采集 · ${props.row?.监测编号 ?? ''}`
  }
  return `编辑监测记录 · ${props.row?.监测编号 ?? ''}`
})

const ownerPost = computed(() => postOfDevice(form.采集设备) || (props.row?.归属岗位 ?? ''))

const limitHint = computed(() => {
  if (props.mode !== 'register') {
    return props.row?.排放限值 ?? ''
  }
  const standard = props.standards.find((item) => item.因子 === form.监测因子)
  return standard ? `${standard.限值} ${standard.单位}` : '选择监测因子后带出'
})

const editable = computed(() => {
  if (props.mode === 'register') {
    return true
  }
  if (!props.row) {
    return false
  }
  if (props.row.锁定) {
    return false
  }
  return props.ctx.post === props.row.归属岗位
})

const valueDisabled = computed(() => {
  if (!editable.value) {
    return true
  }
  return props.mode === 'edit' && props.row?.status === '待采集'
})

const hint = computed(() => {
  if (props.row?.锁定) {
    return `该记录已于 ${props.row.审定时间} 审定（${props.row.审定结论}），整份锁定，本岗位也不能再改。`
  }
  if (props.mode !== 'register' && props.row && props.ctx.post !== props.row.归属岗位) {
    return `只读：该记录归属「${props.row.归属岗位}」，当前岗位「${props.ctx.post}」的保存动作会被打回并留痕。`
  }
  if (props.mode === 'register') {
    return '归属岗位由采集设备自动带出；监测编号重复登记会被拦下。'
  }
  return '监测因子、排放限值为固化字段，仅展示不可改。'
})

function submit() {
  emit('submit', {
    监测编号: form.监测编号,
    监测因子: form.监测因子,
    采集设备: form.采集设备,
    实测值: form.实测值,
    折算值: form.折算值,
    采集时间: form.采集时间 ? form.采集时间.replace('T', ' ') : '',
  })
}
</script>
