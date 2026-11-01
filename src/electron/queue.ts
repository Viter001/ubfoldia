/**
 * One serial queue for every project write: renderer commands, agent commands,
 * save/open/close coordination. A rejected task never poisons the queue.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve(null);

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
