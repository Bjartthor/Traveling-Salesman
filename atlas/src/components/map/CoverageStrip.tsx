// The signature "depth scale" device from 00-PLAN.md §8: a thin bar
// segmented in the four status colours, sized by each status's share of
// whichever metric (countries/area/population) is currently selected.

import type { StatMode } from '@/db/types'
import type { MetricCoverage } from '@/stats/coverage'
import { STATUS_COLOR_VAR, STATUS_LABEL } from '@/components/map/statusColor'
import './CoverageStrip.css'

const nf = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

function formatTotal(mode: StatMode, total: number): string {
  if (mode === 'countries') return nf.format(total)
  if (mode === 'area') return `${compact.format(total)} km²`
  return compact.format(total)
}

interface CoverageStripProps {
  metric: MetricCoverage
  mode: StatMode
}

export function CoverageStrip({ metric, mode }: CoverageStripProps) {
  return (
    <div className="coverage-strip">
      <div className="coverage-strip__track" role="img" aria-label={`Coverage breakdown, ${metric.pct.toFixed(1)}%`}>
        {metric.segments.map((s) => (
          <div
            key={s.status}
            className="coverage-strip__segment"
            style={{ width: `${s.pct}%`, background: STATUS_COLOR_VAR[s.status] }}
            title={`${STATUS_LABEL[s.status]} · ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="coverage-strip__ticks">
        <span className="coverage-strip__tick mono">0</span>
        <span className="coverage-strip__tick mono">{formatTotal(mode, metric.total)}</span>
      </div>
    </div>
  )
}
