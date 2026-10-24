// First run, before there's a profile: the map has nothing to show yet, so the window greets
// with the product's one idea, drawn and stated, and the first step's single action instead of an empty grid.

// The mark opened up: its folder, fork and accounts without the plate, and a terminal that gets the lit one.
import welcomeArt from '../assets/welcome.svg'
import { shortcutLabel, usePlatform } from '../lib/platform'
import { KNOWN_TOOLS } from '../lib/tools'
import { SetupSteps } from './Health'
import { Button } from './ui'

/** `primary`: off while the inspector is open over it, so its Save stays the window's one accent button. */
export function Welcome({ shell, primary, onNewProfile }: { shell: string; primary: boolean; onNewProfile: () => void }) {
  const platform = usePlatform()
  const commands = KNOWN_TOOLS.map((t) => t.command)
  return (
    <main aria-labelledby="welcome-title" className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 pb-4">
      <div className="flex max-w-[440px] animate-[er-rise_300ms_var(--ease-settle)] flex-col items-center text-center">
        {/* A short window shrinks the drawing, so the action stays above the docket. */}
        <img src={welcomeArt} alt="" width={136} height={126} draggable={false} className="h-auto [@media(max-height:520px)]:w-[96px]" />
        <h2 id="welcome-title" className="mt-4 text-display [@media(max-height:520px)]:mt-2 font-semibold tracking-[-0.01em]">
          The folder decides
        </h2>
        {/* The one rule, in one sentence: inside a profile's folders its settings apply, and nowhere else. */}
        <p className="mt-2 text-ink-2">
          In a profile's folders,{' '}
          {commands.map((command, i) => (
            <span key={command}>
              {i > 0 && (i === commands.length - 1 ? ' and ' : ', ')}
              <code className="font-mono text-small text-ink">{command}</code>
            </span>
          ))}{' '}
          use that profile's account and MCP servers; everywhere else, their own defaults.
        </p>
        <SetupSteps step={1} shell={shell} className="mt-6 justify-center" />
        {/* The hint hangs off the button, so the button sits on the column's axis with the art and heading. */}
        <div className="relative mt-5">
          <Button kind={primary ? 'primary' : 'push'} size="large" onClick={onNewProfile} title={`New Profile (${shortcutLabel('n', platform)})`}>
            New Profile
          </Button>
          <kbd className="absolute top-1/2 left-full ml-2.5 -translate-y-1/2 font-sans text-caption whitespace-nowrap text-ink-2">
            {shortcutLabel('n', platform)}
          </kbd>
        </div>
      </div>
    </main>
  )
}
