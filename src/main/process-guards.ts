/**
 * 批5 (plan 2026-09-19 audit remediation): 进程级异常兜底。
 *
 * 此前一个没有 handler 的 rejection / 未捕获异常会直接杀进程——应用没有
 * crashReporter，退出即丢现场：用户只看到窗口消失，日志里没有一行原因。
 * 这里把两者统一落 logger；uncaughtException 记录后**不退出**：此时的
 * 进程状态未知，继续跑有坏数据的风险，但退出等于丢现场且无人上报，
 * 取舍取「留一线 + 留日志」。
 */
export interface GuardLogger {
  error: (message: string) => void
}

/** Register the process-level guards; returns an unwire function (tests). */
export function installProcessGuards(logger: GuardLogger): () => void {
  const onUnhandledRejection = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason)
    logger.error(`unhandled rejection: ${message}`)
  }
  const onUncaughtException = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`uncaught exception: ${message}`)
  }
  process.on('unhandledRejection', onUnhandledRejection)
  process.on('uncaughtException', onUncaughtException)
  return () => {
    process.off('unhandledRejection', onUnhandledRejection)
    process.off('uncaughtException', onUncaughtException)
  }
}
