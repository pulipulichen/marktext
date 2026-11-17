import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, createApp } from 'vue'
import { Muya } from '@muyajs/core'
import { createPlatformPath } from 'common/filesystem/platformPath'
import { imageFilePaths, showImageContextMenu } from '@/contextMenu/imageMenu'
import { popupContextMenu } from '@/contextMenu/popupMenu'
import { copyImageToClipboard, readImagePng } from '@/util/clipboard'
import type * as ClipboardModule from '@/util/clipboard'
import type { ContextMenuItem } from '@/contextMenu/popupMenu'

vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: vi.fn() }))
vi.mock('@/util/index', () => ({ isLinux: true }))
vi.mock('@/util/clipboard', async(importOriginal) => ({
  ...await importOriginal<typeof ClipboardModule>(),
  copyImageToClipboard: vi.fn(async(load: () => Promise<Uint8Array>) => { await load(); return true }),
  readImagePng: vi.fn(async() => new Uint8Array([1, 2, 3]))
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('path', createPlatformPath(false))
  vi.stubGlobal('electron', { process: { platform: 'linux' }, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => vi.unstubAllGlobals())

describe('image context menu paths', () => {
  it('decodes Unicode, spaces and escaped URL characters once, without cache suffixes', () => {
    expect(imageFilePaths('file:///home/user/assets/%E5%9C%96%20%2520%23.png?mucache=1#preview', '/home/user/note.md')).toEqual({
      absolute: '/home/user/assets/圖 %20#.png', relative: './assets/圖 %20#.png'
    })
  })

  it('computes paths outside the Markdown directory', () => {
    expect(imageFilePaths('file:///home/image.png', '/home/notes/note.md')?.relative).toBe('../image.png')
  })

  it('hides paths for unsaved documents, remote images and invalid URLs', () => {
    expect(imageFilePaths('file:///tmp/image.png')).toBeNull()
    for (const src of ['https://example.com/image.png', 'data:image/png;base64,AA==', 'file:///tmp/%GG.png', './image.png']) {
      expect(imageFilePaths(src, '/tmp/note.md')).toBeNull()
    }
  })

  it('handles Windows drives and UNC file URLs', () => {
    vi.stubGlobal('path', createPlatformPath(true))
    window.electron.process.platform = 'win32'
    expect(imageFilePaths('file:///C:/notes/assets/a%20b.png', 'C:\\notes\\note.md')).toEqual({
      absolute: 'C:\\notes\\assets\\a b.png', relative: '.\\assets\\a b.png'
    })
    expect(imageFilePaths('file:///D:/image.png', 'C:\\notes\\note.md')?.relative).toBeNull()
    expect(imageFilePaths('file://server/share/image.png', '\\\\server\\share\\note.md')?.relative).toBe('.\\image.png')
  })
})

describe('image context menu actions', () => {
  it.each([false, true])('keeps the image menu after Muya replaces its host (readOnly: %s)', (readOnly) => {
    // Compile the production listener placement, omitting sibling panels that need desktop stores.
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/renderer/src/components/editorWithTabs/editor.vue'), 'utf8')
    const shell = source.split('<template>')[1].split('<media-viewer')[0] + '</div>'
    const host = document.createElement('div')
    document.body.append(host)
    const onError = vi.fn()
    const app = createApp({
      render: compile(shell),
      setup: () => ({
        typewriter: false,
        focus: false,
        sourceCode: false,
        viewerOpen: false,
        textDirection: 'ltr',
        handleImageContextMenu: (event: MouseEvent) => showImageContextMenu(event, '/tmp/note.md', key => key, onError)
      })
    })
    app.mount(host)
    const original = host.querySelector<HTMLElement>('.editor-component')!
    const engine = new Muya(original, { readOnly })
    try {
      expect(original.isConnected).toBe(false)
      const paragraph = document.createElement('p')
      engine.domNode.append(paragraph)
      const textMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      paragraph.dispatchEvent(textMenu)
      expect(popupContextMenu).not.toHaveBeenCalled()
      if (!readOnly) expect(textMenu.defaultPrevented).toBe(false)
      const readingMenu = vi.fn()
      engine.on('reading-context-menu', readingMenu)
      const image = document.createElement('img')
      image.src = 'file:///tmp/assets/a.png'
      Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 20 } })
      engine.domNode.append(image)
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      image.dispatchEvent(event)
      expect(popupContextMenu).toHaveBeenCalledOnce()
      expect(event.defaultPrevented).toBe(true)
      expect(readingMenu).not.toHaveBeenCalled()
      const items = vi.mocked(popupContextMenu).mock.calls[0][0] as ContextMenuItem[]
      expect(items.map(item => item.label)).toEqual(['contextMenu.copyImage', 'contextMenu.copyRelativeImagePath', 'contextMenu.copyAbsoluteImagePath'])
    } finally {
      engine.destroy()
      app.unmount()
      host.remove()
    }
  })

  const open = (src: string, documentPath?: string) => {
    const image = document.createElement('img')
    image.src = src
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 20 } })
    const event = new MouseEvent('contextmenu', { clientX: 12, clientY: 34, cancelable: true })
    Object.defineProperty(event, 'target', { value: image })
    const onError = vi.fn()
    expect(showImageContextMenu(event, documentPath, key => key, onError)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    const items = vi.mocked(popupContextMenu).mock.calls.at(-1)?.[0] as ContextMenuItem[]
    return { items, onError }
  }

  it('copies image bytes and both file paths from the clicked image', async() => {
    const { items } = open('file:///tmp/assets/a.png?mucache=1', '/tmp/note.md')
    expect(items.map(item => item.label)).toEqual(['contextMenu.copyImage', 'contextMenu.copyRelativeImagePath', 'contextMenu.copyAbsoluteImagePath'])
    items[0].click?.()
    await vi.waitFor(() => expect(readImagePng).toHaveBeenCalledWith('file:///tmp/assets/a.png?mucache=1'))
    expect(copyImageToClipboard).toHaveBeenCalledOnce()
    items[1].click?.()
    items[2].click?.()
    expect(window.electron.clipboard.writeText).toHaveBeenNthCalledWith(1, './assets/a.png')
    expect(window.electron.clipboard.writeText).toHaveBeenNthCalledWith(2, '/tmp/assets/a.png')
  })

  it('still offers image copy for remote images and unsaved documents', () => {
    expect(open('https://example.com/image.png', '/tmp/note.md').items).toHaveLength(1)
    expect(open('file:///tmp/image.png').items).toHaveLength(1)
  })

  it('reports failed image copies', async() => {
    vi.mocked(copyImageToClipboard).mockRejectedValueOnce(new Error('decode failed'))
    const { items, onError } = open('file:///tmp/image.png')
    items[0].click?.()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
  })

  it('leaves non-image menus untouched', () => {
    const event = new MouseEvent('contextmenu', { cancelable: true })
    Object.defineProperty(event, 'target', { value: document.createElement('p') })
    expect(showImageContextMenu(event, '/tmp/note.md', key => key, vi.fn())).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(popupContextMenu).not.toHaveBeenCalled()
  })
})
