export type StateSync = { ok: boolean; error?: string };

/**
 * Blur the focused editor so its blur handler commits the pending edit before
 * the following state read acts as a queue barrier.
 */
export async function flushFocusedEditor(
  active: { blur(): void } | null,
  sync: () => Promise<StateSync>,
): Promise<string | null> {
  active?.blur();
  const result = await sync();
  return result.ok ? null : result.error || '状态同步失败';
}

export type FlushCoordinatorOptions = {
  send: (id: string) => void;
  /** False once the renderer or window is gone. */
  isAvailable: () => boolean;
  id?: () => string;
  timeoutMs?: number;
};

type FlushWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Asks the renderer to blur its active editor and waits for the state barrier.
 * The request is always settled: response, timeout, or renderer destruction.
 */
export class FlushCoordinator {
  private readonly waiters = new Map<string, FlushWaiter>();
  private readonly timeoutMs: number;

  constructor(private readonly options: FlushCoordinatorOptions) {
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  flush(): Promise<void> {
    if (!this.options.isAvailable()) {
      return Promise.reject(Error('窗口不可用，未执行保存或关闭'));
    }
    return new Promise<void>((resolve, reject) => {
      const id = (this.options.id ?? (() => crypto.randomUUID()))();
      const timer = setTimeout(() => {
        if (!this.waiters.delete(id)) return;
        reject(Error('编辑器未响应，未执行保存或关闭'));
      }, this.timeoutMs);
      this.waiters.set(id, { resolve, reject, timer });
      try {
        this.options.send(id);
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error instanceof Error ? error : Error(String(error)));
      }
    });
  }

  settle(id: string, error?: string) {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(id);
    if (error) waiter.reject(Error(error));
    else waiter.resolve();
  }

  cancelAll(message = '窗口不可用，未执行保存或关闭') {
    for (const [id, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(Error(message));
      this.waiters.delete(id);
    }
  }
}
