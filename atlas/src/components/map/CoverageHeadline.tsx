import type { StatMode } from '@/db/types'
import type { MetricCoverage } from '@/stats/coverage'
import { METRIC_LABELS } from '@/stats/coverage'
import { useTweenedNumber } from '@/components/map/useTweenedNumber'
import './CoverageHeadline.css'

// Same order as coverage.ts's internal METRIC_CYCLE (not exported — this is
// purely the dot-position readout, not a source of truth for cycling logic).
const MODE_ORDER: readonly StatMode[] = ['countries', 'area', 'population']

interface CoverageHeadlineProps {
  metric: MetricCoverage
  mode: StatMode
  onCycle: () => void
}

export function CoverageHeadline({ metric, mode, onCycle }: CoverageHeadlineProps) {
  const tweened = useTweenedNumber(metric.pct)

  return (
    <button type="button" className="coverage-headline" onClick={onCycle}>
      <span className="coverage-headline__value">{tweened.toFixed(1)}%</span>
      <span className="coverage-headline__label mono">{METRIC_LABELS[mode]}</span>
      <span className="coverage-headline__dots" aria-hidden="true">
        {MODE_ORDER.map((m) => (
          <span key={m} className={`coverage-headline__dot${m === mode ? ' coverage-headline__dot--active' : ''}`} />
        ))}
      </span>
    </button>
  )
}
