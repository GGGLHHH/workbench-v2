import { toast } from 'sonner';
import type { NotifyFn } from '@gedatou/editor';

/** 默认 notify：sonner toast。库内提示走注入的 NotifyFn。 */
export const sonnerNotify: NotifyFn = (msg, level) =>
  level === 'error' ? toast.error(msg) : level === 'success' ? toast.success(msg) : toast(msg);
