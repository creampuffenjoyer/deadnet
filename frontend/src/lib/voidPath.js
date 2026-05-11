export const VOID_PATH = (() => {
  try { return atob(import.meta.env.VITE_VOID_B64 || '') }
  catch { return '' }
})()
