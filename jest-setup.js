// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// jsdom ships without TextEncoder/TextDecoder; react-dom/server (pulled in by
// @grafana/ui) needs them at import time
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { TextEncoder, TextDecoder });

// jsdom has no canvas; @grafana/ui's Combobox measures option text via a 2D context
HTMLCanvasElement.prototype.getContext = () => ({
  measureText: (text) => ({ width: text.length * 8 }),
});

// jsdom has no IntersectionObserver; the Combobox dropdown's virtualized list needs one
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};
