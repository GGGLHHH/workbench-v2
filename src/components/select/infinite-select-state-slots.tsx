import { useTranslation } from 'react-i18next'

import {
  InfiniteSelectEmpty,
  InfiniteSelectError,
  InfiniteSelectLoading,
  InfiniteSelectLoadingMore,
  InfiniteSelectRetry,
} from '@/components/select/infinite-select'

// 三个业务下拉(member/tag/prompt-preset)共用的内置状态插槽:空 / 加载 / 加载更多 / 错误+重试。
// loading/loadFailed/retry 固定走 common.*;只有 empty/loadingMore 两段随实体变 → 作 prop 传入。
// 不引入配置对象或泛型 —— 只是把 3×8 行逐字重复的 JSX 收进一处(底座仍零文案,文案在此业务层注入)。
export function InfiniteSelectStateSlots({
  emptyText,
  loadingMoreText,
}: {
  emptyText: string
  loadingMoreText: string
}) {
  const { t } = useTranslation()
  return (
    <>
      <InfiniteSelectEmpty>{emptyText}</InfiniteSelectEmpty>
      <InfiniteSelectLoading>{t('common.loading')}</InfiniteSelectLoading>
      <InfiniteSelectLoadingMore>{loadingMoreText}</InfiniteSelectLoadingMore>
      <InfiniteSelectError>
        {t('common.loadFailed')}
        <InfiniteSelectRetry>{t('common.retry')}</InfiniteSelectRetry>
      </InfiniteSelectError>
    </>
  )
}
