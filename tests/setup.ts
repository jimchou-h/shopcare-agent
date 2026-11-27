import '@testing-library/jest-dom/vitest';

// 测试默认使用内存库，避免在仓库里留下演示数据文件；需要重建恢复的测试显式传临时路径。
process.env.DATABASE_PATH = ':memory:';
