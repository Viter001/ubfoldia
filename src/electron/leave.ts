import type { LeaveChoice, LeavePrompt, LeaveReason, LeaveResult } from '../shared/leave';
export type { LeaveChoice, LeavePrompt, LeaveReason, LeaveResult } from '../shared/leave';

export type LeaveFlow = {
  isDirty: () => boolean;
  id: () => string;
  projectName: () => string;
  request: (prompt: LeavePrompt) => void;
  nextChoice: (id: string) => Promise<LeaveChoice>;
  save: () => Promise<void>;
  notify: (result: LeaveResult) => void;
};

export type LeaveSession = {
  dirty(): boolean;
  active(): { project: { name: string } };
  save(): Promise<void>;
};

export type LeaveCoordinatorOptions = {
  session: LeaveSession;
  sendRequest: (prompt: LeavePrompt) => void;
  sendResult: (result: LeaveResult) => void;
  id?: () => string;
  timeoutMs?: number;
};

export const LEAVE_TIMEOUT = 5 * 60 * 1000;

export function isTrustedSender(
  sender: unknown,
  frame: unknown,
  expectedSender: unknown,
  expectedFrame: unknown,
) {
  return sender === expectedSender && frame === expectedFrame;
}

/**
 * Ask before leaving a dirty project. A failed save keeps the same prompt open
 * and waits for a retry or cancel, so the project is never discarded on error.
 */
export async function confirmLeave(flow: LeaveFlow, reason: LeaveReason): Promise<boolean> {
  if (!flow.isDirty()) return true;
  const id = flow.id();
  flow.request({ id, reason, projectName: flow.projectName() });
  for (;;) {
    const choice = await flow.nextChoice(id);
    if (choice === 'cancel') return false;
    if (choice === 'discard') {
      flow.notify({ id, ok: true, closed: true });
      return true;
    }
    try {
      await flow.save();
      flow.notify({ id, ok: true, closed: true });
      return true;
    } catch (error) {
      flow.notify({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

type LeaveWaiter = {
  timer: ReturnType<typeof setTimeout>;
  resolve: (choice: LeaveChoice) => void;
};

/**
 * Owns leave prompts and their waiters. Every path settles: user response,
 * timeout, renderer destruction or an error in the leave flow.
 */
export class LeaveCoordinator {
  private readonly waiters = new Map<string, LeaveWaiter>();
  private leaveOpen = false;
  private rendererGone = false;
  private readonly timeoutMs: number;

  constructor(private readonly options: LeaveCoordinatorOptions) {
    this.timeoutMs = options.timeoutMs ?? LEAVE_TIMEOUT;
  }

  get open() {
    return this.leaveOpen;
  }

  respond(id: string, choice: LeaveChoice) {
    this.waiters.get(id)?.resolve(choice);
  }

  markRendererGone() {
    this.rendererGone = true;
    for (const waiter of this.waiters.values()) waiter.resolve('cancel');
    this.waiters.clear();
  }

  async mayLeave(reason: LeaveReason): Promise<boolean> {
    if (!this.options.session.dirty()) return true;
    if (this.leaveOpen) return false;
    this.leaveOpen = true;
    try {
      return await confirmLeave(
        {
          isDirty: () => this.options.session.dirty(),
          id: this.options.id ?? (() => crypto.randomUUID()),
          projectName: () => this.options.session.active().project.name,
          request: (prompt) => {
            if (this.rendererGone) throw Error('窗口不可用，无法确认未保存修改');
            this.options.sendRequest(prompt);
          },
          nextChoice: (id) => this.nextChoice(id),
          save: () => this.options.session.save(),
          notify: this.options.sendResult,
        },
        reason,
      );
    } finally {
      this.leaveOpen = false;
      for (const waiter of this.waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.resolve('cancel');
      }
      this.waiters.clear();
    }
  }

  private nextChoice(id: string): Promise<LeaveChoice> {
    if (this.rendererGone) return Promise.resolve('cancel');
    return new Promise<LeaveChoice>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.waiters.delete(id)) return;
        this.options.sendResult({
          id,
          ok: false,
          closed: true,
          error: '等待确认超时，操作已取消。',
        });
        resolve('cancel');
      }, this.timeoutMs);
      this.waiters.set(id, {
        timer,
        resolve: (choice) => {
          if (!this.waiters.delete(id)) return;
          clearTimeout(timer);
          resolve(choice);
        },
      });
    });
  }
}
