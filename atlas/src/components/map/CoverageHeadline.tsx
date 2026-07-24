import type { StatMode } from '@/db/types'
import type { MetricCoverage } from '@/stats/coverage'
import { METRIC_LABELS } from '@/stats/coverage'
import { useTweenedNumber } from '@/components/map/useTweenedNumber'
import './CoverageHeadline.css'

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
    </button>
  )
}
