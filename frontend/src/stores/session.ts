import { defineStore } from 'pinia'

const POST_STORAGE_KEY = 'waste-to-energy-plant:session-post'
const OPERATOR_STORAGE_KEY = 'waste-to-energy-plant:session-operator'

function readStored(key: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  return window.localStorage.getItem(key) || fallback
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: readStored(OPERATOR_STORAGE_KEY, '王值班'),
    shiftLabel: '白班 08:00-20:00',
    scope: '生活垃圾焚烧发电厂运行管理平台',
    // 当前操作人所在岗位：CEMS 归属校验就认这个身份，可在页头切换模拟不同岗位。
    postCode: readStored(POST_STORAGE_KEY, 'fluegas-post'),
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setPost(code: string) {
      this.postCode = code
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(POST_STORAGE_KEY, code)
      }
    },
    setOperator(name: string) {
      this.operator = name
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(OPERATOR_STORAGE_KEY, name)
      }
    },
  },
})
