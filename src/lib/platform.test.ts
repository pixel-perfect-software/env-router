import { afterEach, describe, expect, it, vi } from 'vitest'
import { guessPlatform, isShortcut, platformInfo, shortcutLabel } from './platform'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guessPlatform', () => {
  it('reads the platform from the user agent, until the backend has answered', () => {
    const guess = (userAgent: string) => {
      vi.stubGlobal('navigator', { userAgent })
      return guessPlatform()
    }
    expect(guess('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('macos')
    expect(guess('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe('windows')
    expect(guess('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15')).toBe('linux')
  })
})

describe('platformInfo', () => {
  it('names the store each platform keeps secrets in, WSL using the Credential Manager of Windows', () => {
    expect(platformInfo('macos').secretStore).toBe('Keychain')
    expect(platformInfo('linux').secretStore).toBe('keyring')
    expect(platformInfo('wsl').secretStore).toBe('Credential Manager')
    expect(platformInfo('windows').secretStore).toBe('Credential Manager')
  })

  it("takes the backend's words for the store and the file manager over its own", () => {
    const words = { secretStore: 'KWallet', sealedLabel: 'In the KWallet', secretStoreProblem: null, fileManager: 'Dolphin', revealVerb: 'Open' }
    const info = platformInfo('linux', words)
    expect([info.secretStore, info.sealedLabel, info.revealLabel, info.revealLabelOf('config.json')]).toEqual([
      'KWallet',
      'In the KWallet',
      'Open in Dolphin',
      'Open config.json in Dolphin',
    ])
  })
})

describe('shortcutLabel', () => {
  it('writes ⌘ on a Mac and Ctrl+ elsewhere, in capitals', () => {
    expect(shortcutLabel('o', platformInfo('macos'))).toBe('⌘O')
    expect(shortcutLabel('o', platformInfo('linux'))).toBe('Ctrl+O')
  })
})

describe('isShortcut', () => {
  const press = (modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>) =>
    ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent
  const mac = platformInfo('macos')
  const linux = platformInfo('linux')

  it('is ⌘ on a Mac, and not Ctrl or ⌘ and Ctrl together', () => {
    expect(isShortcut(press({ metaKey: true }), mac)).toBe(true)
    expect(isShortcut(press({ ctrlKey: true }), mac)).toBe(false)
    expect(isShortcut(press({ metaKey: true, ctrlKey: true }), mac)).toBe(false)
  })

  it('is Ctrl elsewhere, and not with ⌘ or Shift', () => {
    expect(isShortcut(press({ ctrlKey: true }), linux)).toBe(true)
    expect(isShortcut(press({ metaKey: true }), linux)).toBe(false)
    expect(isShortcut(press({ ctrlKey: true, shiftKey: true }), linux)).toBe(false)
  })

  it('is never a shortcut with Option or Alt held', () => {
    expect(isShortcut(press({ metaKey: true, altKey: true }), mac)).toBe(false)
    expect(isShortcut(press({ ctrlKey: true, altKey: true }), linux)).toBe(false)
  })
})
