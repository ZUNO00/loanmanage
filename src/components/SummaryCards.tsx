'use client'

import type { DashboardSummary } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'

export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Phải trả tháng này</p>
        <p className="text-lg font-bold text-payable">{formatMoney(summary.totalPayableThisMonth)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Phải thu tháng này</p>
        <p className="text-lg font-bold text-receivable">{formatMoney(summary.totalReceivableThisMonth)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Lãi dự kiến thu/tháng</p>
        <p className="text-lg font-bold text-receivable">{formatMoney(summary.monthlyInterestReceivable)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Lãi phải trả/tháng</p>
        <p className="text-lg font-bold text-payable">{formatMoney(summary.monthlyInterestPayable)}đ</p>
      </div>
      {summary.overdue.length > 0 && (
        <div className="col-span-2 rounded-xl border border-payable bg-surface p-3">
          <p className="text-xs text-payable">⚠ {summary.overdue.length} khoản quá hạn</p>
          {summary.overdue.map(({ debt }) => (
            <p key={debt.id} className="text-sm text-text">{debt.name}</p>
          ))}
        </div>
      )}
    </div>
  )
}
