/**
 * ANSI Theme - Soft Dark Material
 *
 * Terminal color utilities with a beautiful dark theme
 */

// ANSI escape codes
const ESC = '\x1b['
const RESET = `${ESC}0m`

// 256-color palette for soft dark material theme
export const theme = {
  // Base colors
  bg: `${ESC}48;5;235m`, // Soft dark gray background
  fg: `${ESC}38;5;253m`, // Light gray text

  // Accent colors (Material Design inspired)
  primary: `${ESC}38;5;75m`, // Soft blue
  secondary: `${ESC}38;5;183m`, // Soft purple
  accent: `${ESC}38;5;114m`, // Soft green

  // Severity colors
  critical: `${ESC}38;5;203m`, // Soft red
  high: `${ESC}38;5;215m`, // Soft orange
  medium: `${ESC}38;5;221m`, // Soft yellow
  low: `${ESC}38;5;114m`, // Soft green

  // UI elements
  border: `${ESC}38;5;240m`, // Dim gray for borders
  muted: `${ESC}38;5;245m`, // Muted text
  success: `${ESC}38;5;114m`, // Green
  warning: `${ESC}38;5;215m`, // Orange
  error: `${ESC}38;5;203m`, // Red

  // Styles
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  reset: RESET,
}

// Color helper functions
export function colorize(text: string, ...styles: string[]): string {
  return `${styles.join('')}${text}${RESET}`
}

export function primary(text: string): string {
  return colorize(text, theme.primary)
}

export function secondary(text: string): string {
  return colorize(text, theme.secondary)
}

export function accent(text: string): string {
  return colorize(text, theme.accent)
}

export function muted(text: string): string {
  return colorize(text, theme.muted)
}

export function bold(text: string): string {
  return colorize(text, theme.bold)
}

export function success(text: string): string {
  return colorize(text, theme.success)
}

export function warning(text: string): string {
  return colorize(text, theme.warning)
}

export function error(text: string): string {
  return colorize(text, theme.error)
}

export function severity(level: string): string {
  switch (level) {
    case 'critical':
      return colorize(`● ${level}`, theme.critical)
    case 'high':
      return colorize(`● ${level}`, theme.high)
    case 'medium':
      return colorize(`● ${level}`, theme.medium)
    case 'low':
      return colorize(`● ${level}`, theme.low)
    default:
      return level
  }
}

// Progress bar
export function progressBar(current: number, max: number, width = 20): string {
  const ratio = max > 0 ? current / max : 0
  const filled = Math.round(ratio * width)
  const empty = width - filled

  const filledColor = ratio > 0.9 ? theme.critical : ratio > 0.7 ? theme.warning : theme.accent
  const bar = `${filledColor}${'█'.repeat(filled)}${theme.muted}${'░'.repeat(empty)}${RESET}`

  return bar
}

// Clear screen
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H')
}

// Hide/show cursor
export function hideCursor(): void {
  process.stdout.write('\x1b[?25l')
}

export function showCursor(): void {
  process.stdout.write('\x1b[?25h')
}
