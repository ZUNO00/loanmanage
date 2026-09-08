'use client'

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

interface Props {
  days: Array<{ date: Date; hasUnpaid: boolean; hasNote: boolean }>
  selected: Date
  onSelect: (date: Date) => void
}

export function WeekStrip({ days, selected, onSelect }: Props) {
  return (
    <div className="flex gap-2">
      {days.map(({ date, hasUnpaid, hasNote }) => {
        const isSelected = date.toDateString() === selected.toDateString()
        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelect(date)}
            className={`flex-1 rounded-xl p-2 text-center ring-2 ${isSelected ? 'ring-text' : 'ring-transparent'} ${
              hasUnpaid ? 'bg-gradient-to-br from-urgent-from to-urgent-to text-white' : hasNote ? 'bg-note text-bg' : 'bg-surface text-text-muted'
            }`}
          >
            <div className="text-[10px]">{WEEKDAY_LABELS[(date.getDay() + 6) % 7]}</div>
            <div className="text-sm font-semibold">{date.getDate()}</div>
          </button>
        )
      })}
    </div>
  )
}
