// The standard detail line for an action breadcrumb (place/nav/city…): the JS
// heap and the on-screen render geometry together. Kept in one place because a
// renderer crash can come from either budget — the captured OOM logs proved
// heap alone stays low while the tab dies, so every breadcrumb that used to
// carry only heapSummary() now carries the geometry beside it (@/debug/
// renderVitals). Returns undefined when there's nothing to report, so callers
// keep passing the result straight through to logInfo's optional detail arg.

import { heapSummary } from '@/debug/memory'
import { renderVitalsSummary } from '@/debug/renderVitals'

export function breadcrumbDetail(prefix?: string): string | undefined {
  return [prefix, heapSummary(), renderVitalsSummary()].filter(Boolean).join(' · ') || undefined
}
