// CloudKitSync web/PWA 回退实现（no-op）。
// 真正的同步只在 iOS 原生包装层（Capacitor 原生插件）中生效；
// 以 PWA / 浏览器方式打开时，数据仅保留在 localStorage。
export function save() { return Promise.resolve(); }
export function fetch() { return Promise.resolve({ value: '' }); }
export function isAvailable() { return Promise.resolve({ available: false }); }
