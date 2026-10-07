import { defineStore } from 'pinia'

import { CEMS_POSTS } from '@/data/cems/constants'

// 当前岗位身份：归属控制按岗位判定。身份存在 localStorage 里，
// 切到第三方运维岗再去改别的站的数，能直接看到被打回并留痕。
const POST_KEY = 'waste-to-energy-plant:current-post'
const OPERATOR_KEY = 'waste-to-energy-plant:current-operator'

const FALLBACK_OPERATOR: Record<string, string> = {
  '1号CEMS监测岗': '李监测',
  '2号CEMS监测岗': '陈监测',
  第三方运维岗: '外协-赵运维',
  环保管理岗: '王审定',
}

function read(key: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  return window.localStorage.getItem(key) || fallback
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: read(OPERATOR_KEY, FALLBACK_OPERATOR[CEMS_POSTS[0]] ?? '值班员'),
    operatorTouched: read(OPERATOR_KEY, '') !== '',
    shiftLabel: '白班 08:00-20:00',
    scope: '生活垃圾焚烧发电厂运行管理平台',
    post: read(POST_KEY, CEMS_POSTS[0]),
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setPost(post: string) {
      this.post = post
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(POST_KEY, post)
      }
      // 没手填过操作人时，切岗位带上该岗位的默认值班人，方便演示倒查。
      if (!this.operatorTouched) {
        this.operator = FALLBACK_OPERATOR[post] ?? this.operator
      }
    },
    setOperator(name: string) {
      this.operator = name
      this.operatorTouched = true
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(OPERATOR_KEY, name)
      }
    },
  },
})
