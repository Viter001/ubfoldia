import { useEffect, useReducer, useRef } from 'react';
import { leaveReducer, type LeaveChoice, type LeaveState } from './leave';

/**
 * Connects the main-process leave prompts to the dialog reducer. Stale or
 * timed-out results are routed to the banner by the caller's onError.
 */
export function useLeaveDialog(onError: (message: string) => void) {
  const [leave, dispatchLeave] = useReducer(leaveReducer, null);
  const leaveRef = useRef<LeaveState>(null);

  useEffect(() => {
    leaveRef.current = leave;
  }, [leave]);

  useEffect(() => {
    const offRequest = window.studio.onLeaveRequest((prompt) => {
      onError('');
      dispatchLeave({ type: 'request', prompt });
    });
    const offResult = window.studio.onLeaveResult((result) => {
      dispatchLeave({ type: 'result', result });
      if (result.closed && !result.ok && leaveRef.current?.prompt.id === result.id)
        onError(result.error || '操作已取消。');
    });
    return () => {
      offRequest();
      offResult();
    };
  }, [onError]);

  function answer(choice: LeaveChoice) {
    if (!leave || leave.busy) return;
    const id = leave.prompt.id;
    if (choice === 'cancel') {
      dispatchLeave({ type: 'cancel' });
      window.studio.respondLeave(id, choice);
      return;
    }
    dispatchLeave({ type: 'responding' });
    try {
      window.studio.respondLeave(id, choice);
    } catch {
      dispatchLeave({
        type: 'result',
        result: { id, ok: false, error: '无法提交保存确认，请重试。' },
      });
    }
  }

  return { leave, answer };
}
