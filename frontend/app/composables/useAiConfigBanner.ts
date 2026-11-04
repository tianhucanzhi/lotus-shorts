/**
 * 设置页写入/变更 AI 配置后，通知布局重新检查顶部「未配置模型」横幅。
 * 布局跨页复用，仅靠 route 变化不够。
 */
export function useAiConfigBanner() {
  const tick = useState('ai-config-banner-tick', () => 0)

  function notifyAiConfigsChanged() {
    tick.value += 1
  }

  return { tick, notifyAiConfigsChanged }
}
