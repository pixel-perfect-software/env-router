// The window's icons: Lucide, drawn at a true 1.5px stroke whatever the size, so every glyph
// matches the 16px grid in DESIGN.md. Agents get their own marks (Simple Icons, CC0), in ink
// colour like any other icon, so a row says which agent it is at a glance.

import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  CornerDownRight,
  Folder,
  FolderDown,
  FolderSearch,
  Globe,
  Import,
  Lock,
  type LucideIcon,
  type LucideProps,
  Package,
  Pencil,
  Plug,
  Plus,
  RadioTower,
  SquareTerminal,
  X,
} from 'lucide-react'
import { type SimpleIcon, siClaude, siGithubcopilot } from 'simple-icons'
import type { McpServer } from '../lib/types'

const sized = (Glyph: LucideIcon, size: number) =>
  function SizedIcon(props: LucideProps) {
    return <Glyph size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" {...props} />
  }

export const PencilIcon = sized(Pencil, 14)
export const PlusIcon = sized(Plus, 16)
export const CloseIcon = sized(X, 16)
export const BackIcon = sized(ChevronLeft, 16)
export const ChevronIcon = sized(ChevronRight, 12)
/** A folder dropping onto the window: the idle docket. */
export const DropIcon = sized(FolderDown, 16)
/** The inset carve-out marker: a nested trigger handed to another profile. */
export const BranchIcon = sized(CornerDownRight, 12)
export const FolderIcon = sized(Folder, 14)
export const FolderCheckIcon = sized(FolderSearch, 16)
export const ShellIcon = sized(SquareTerminal, 16)
export const EditorIcon = sized(CodeXml, 16)
/** MCP as a whole: the library, a card's server line, a profile's server list. */
export const PlugIcon = sized(Plug, 14)
export const LockIcon = sized(Lock, 12)
export const CatalogIcon = sized(Package, 16)
export const ImportIcon = sized(Import, 16)
export const CheckIcon = sized(Activity, 16)

const TRANSPORT: Record<McpServer['transport'], LucideIcon> = { stdio: SquareTerminal, http: Globe, sse: RadioTower }

/** How a server is reached: a terminal for a command, a globe for HTTP, a tower for SSE. */
export function TransportIcon({ transport, size = 14 }: { transport: McpServer['transport']; size?: number }) {
  const Glyph = TRANSPORT[transport]
  return <Glyph size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
}

// Claude's starburst rather than the Claude Code mascot, which blurs into a blob at 14px.
const AGENT_MARKS: Record<string, SimpleIcon> = { claude: siClaude, copilot: siGithubcopilot }

/** An agent's logo, or a generic bot for one added by hand. */
export function AgentMark({ command, size = 14, className = '' }: { command: string; size?: number; className?: string }) {
  const mark = AGENT_MARKS[command]
  if (!mark) return <Bot size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className={className} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={mark.path} />
    </svg>
  )
}
