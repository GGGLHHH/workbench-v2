// ponytail: 内存 FIFO 单 worker,任务表随进程重启丢失;要持久化/并发时换正式队列(BullMQ 等)。
// renderer.ts 的渲染任务与 clip/service.ts 的生成任务原各写一份同构队列,这里收一处。
export function createQueue() {
  const queue: (() => Promise<void>)[] = [];
  let running = false;
  const pump = async (): Promise<void> => {
    if (running) return;
    running = true;
    while (queue.length > 0) await queue.shift()!();
    running = false;
  };
  return {
    // 入队并触发泵:空闲则启动串行消费,忙则排队等当前 worker 取。
    push(fn: () => Promise<void>): void {
      queue.push(fn);
      void pump();
    },
  };
}
