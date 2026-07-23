import type { BffProjectOptions } from '@/generated/api-types'
import type { MetaDraft } from './meta-draft'
import { Row } from '@/components/project-nav/fields'
import { Input } from '@/components/ui/input'
import { MemberInfiniteSelect } from '@/components/member-infinite-select'
import { Button } from '@/components/ui/button'

// 编辑表单:1:1 对齐 xchangeai-workbench 的 ProjectMetaPanel(字段、顺序、行分组、下拉、
// Cancel/Save details)。下游是 PUT 整体替换,所以表单持有全量值一起提交。
export function MetaForm({
  value: v,
  onChange,
  options,
  optionsLoading,
  onCancel,
  onSave,
}: {
  value: MetaDraft
  onChange: (v: MetaDraft) => void
  options: BffProjectOptions | undefined
  optionsLoading: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const set = (k: keyof MetaDraft) => (e: { target: { value: string } }) =>
    onChange({ ...v, [k]: e.target.value })

  const selects = [
    { key: 'agencyId', kind: 'agency', label: 'Agency', empty: 'No agency', items: options?.agencies },
    { key: 'agentId', kind: 'agent', label: 'Agent', empty: 'No agent', items: options?.agents },
    { key: 'assigneeId', kind: 'assignee', label: 'Assigned creator', empty: 'Unassigned', items: options?.assignees },
  ] as const

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <Row label="Listing URL">
        <Input type="url" className="h-8" value={v.listingUrl} onChange={set('listingUrl')} />
      </Row>
      <Row label="Address">
        <Input className="h-8" value={v.address} onChange={set('address')} />
      </Row>
      <Row label="Address line 2">
        <Input className="h-8" value={v.address2} onChange={set('address2')} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="City">
          <Input className="h-8" value={v.city} onChange={set('city')} />
        </Row>
        <Row label="State">
          <Input className="h-8" value={v.state} onChange={set('state')} />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Postal code">
          <Input className="h-8" value={v.postalCode} onChange={set('postalCode')} />
        </Row>
        <Row label="Property type">
          <Input className="h-8" value={v.propertyType} onChange={set('propertyType')} />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="List price">
          <Input type="number" min="0" className="h-8" value={v.price} onChange={set('price')} />
        </Row>
        <Row label="Video style">
          <Input className="h-8" value={v.videoStyle} onChange={set('videoStyle')} />
        </Row>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Row label="Beds">
          <Input type="number" min="0" step="any" className="h-8" value={v.bedrooms} onChange={set('bedrooms')} />
        </Row>
        <Row label="Baths">
          <Input type="number" min="0" step="any" className="h-8" value={v.bathrooms} onChange={set('bathrooms')} />
        </Row>
        <Row label="Sqft">
          <Input
            type="number"
            min="0"
            className="h-8"
            value={v.livingAreaSqft}
            onChange={set('livingAreaSqft')}
          />
        </Row>
      </div>
      {selects.map((s) => (
        <Row key={s.key} label={s.label}>
          <MemberInfiniteSelect
            kind={s.kind}
            value={v[s.key]}
            selectedItem={(s.items ?? []).find((o) => o.id === v[s.key])}
            placeholder={s.empty}
            disabled={optionsLoading}
            onChange={(item) => onChange({ ...v, [s.key]: item?.id ?? '' })}
          />
        </Row>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8">
          Save details
        </Button>
      </div>
    </form>
  )
}
