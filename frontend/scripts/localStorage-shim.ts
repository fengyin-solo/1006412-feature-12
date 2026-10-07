/** 给 Node 验证脚本注入一个内存版 window/localStorage，业务代码原样跑、不改一行业务逻辑。 */
const memory = new Map<string, string>()

const localStorageShim = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => {
    memory.set(key, String(value))
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => memory.clear(),
}

;(globalThis as any).window = { localStorage: localStorageShim }
;(globalThis as any).localStorage = localStorageShim
