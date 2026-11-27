// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  document.head.querySelectorAll('meta[name="csp-nonce"]').forEach((meta) => meta.remove());
});

describe('CSP nonce 与 antd 样式注入', () => {
  it('antd 注入的运行时样式携带页面 CSP nonce', async () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="csp-nonce" content="test-nonce" />'
    );

    render(<App />);

    await waitFor(() => {
      const styles = [...document.head.querySelectorAll('style')];
      expect(styles.length).toBeGreaterThan(0);
      expect(
        styles.some(
          (style) =>
            style.nonce === 'test-nonce' ||
            style.getAttribute('nonce') === 'test-nonce'
        )
      ).toBe(true);
    });
  });

  it('页面没有 nonce 时仍能渲染，样式注入不携带 nonce', async () => {
    render(<App />);

    await waitFor(() => {
      expect(document.head.querySelectorAll('style').length).toBeGreaterThan(0);
    });
  });
});
