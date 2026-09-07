const formatter = new Intl.NumberFormat('vi-VN')

export function formatMoney(value: number): string {
  return formatter.format(Math.round(value))
}

/** Strips everything but digits, so a formatted input like "14.000.000"
 * round-trips back to the plain number 14000000. */
export function parseMoneyDigits(input: string): number {
  const digits = input.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

/** Re-formats a raw input value as the user types. */
export function formatMoneyInput(input: string): string {
  return formatMoney(parseMoneyDigits(input))
}
