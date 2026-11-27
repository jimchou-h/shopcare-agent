import '@testing-library/jest-dom/vitest';

// 测试默认使用内存库，避免在仓库里留下演示数据文件；需要重建恢复的测试显式传临时路径。
process.env.DATABASE_PATH = ':memory:';

// antd 的响应式栅格需要 matchMedia；jsdom 未实现，用固定不命中的替身。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }) as MediaQueryList;
}

// antd 的尺寸监听依赖 ResizeObserver；jsdom 中提供无副作用的空实现。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
