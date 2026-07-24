import { STATUS_COLOR_VAR, STATUS_LABEL, STATUS_ORDER } from '@/components/map/statusColor'
import './Legend.css'

export function Legend() {
  return (
    <details className="legend">
      <summary className="legend__summary mono">Legend</summary>
      <ul className="legend__list">
        {STATUS_ORDER.map((status) => (
          <li key={status} className="legend__item">
            <span className="legend__swatch" style={{ background: STATUS_COLOR_VAR[status] }} aria-hidden="true" />
            <span>{STATUS_LABEL[status]}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
