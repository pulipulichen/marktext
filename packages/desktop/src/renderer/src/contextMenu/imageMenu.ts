import { clipboardImagePath, copyImageToClipboard, readImagePng } from '@/util/clipboard'
import { popupContextMenu } from './popupMenu'
import type { ContextMenuItem } from './popupMenu'

interface ImageCopyAction {
  id: string
  label: string
  enabled?: boolean
  click: () => void
}

/** Use the rendered file URL, which Muya has already resolved against the document. */
export const imageFilePaths = (src: string, documentPath?: string): { absolute: string; relative: string | null } | null => {
  if (!documentPath || !window.path.isAbsolute(documentPath)) return null
  try {
    if (new URL(src).protocol !== 'file:') return null
    const absolute = window.path.normalize(clipboardImagePath(src))
    if (!window.path.isAbsolute(absolute)) return null
    const relative = window.path.relative(window.path.dirname(documentPath), absolute)
    return {
      absolute,
      // A Windows image on another drive has no relative path.
      relative: window.path.isAbsolute(relative) ? null : relative.startsWith('.') ? relative : `.${window.path.sep}${relative}`
    }
  } catch {
    return null
  }
}

export const createImageCopyActions = (
  image: HTMLImageElement,
  documentPath: string | undefined,
  translate: (key: string) => string,
  onError: (error: unknown) => void
): ImageCopyAction[] => {
  const src = image.currentSrc || image.src
  const paths = imageFilePaths(src, documentPath)
  const items: ImageCopyAction[] = [
    {
      id: 'copy-image',
      label: translate('contextMenu.copyImage'),
      enabled: image.complete && image.naturalWidth > 0,
      click: () => {
        void copyImageToClipboard(() => readImagePng(src))
          .then(written => { if (!written) throw new Error('The clipboard rejected the image') })
          .catch(onError)
      }
    }
  ]
  if (paths) {
    items.push(
      {
        id: 'copy-relative-image-path',
        label: translate('contextMenu.copyRelativeImagePath'),
        enabled: paths.relative !== null,
        click: () => { if (paths.relative !== null) void window.electron.clipboard.writeText(paths.relative).catch(onError) }
      },
      {
        id: 'copy-absolute-image-path',
        label: translate('contextMenu.copyAbsoluteImagePath'),
        click: () => { void window.electron.clipboard.writeText(paths.absolute).catch(onError) }
      }
    )
  }
  return items
}

export const showImageContextMenu = (
  event: MouseEvent,
  documentPath: string | undefined,
  translate: (key: string) => string,
  onError: (error: unknown) => void
): boolean => {
  if (!(event.target instanceof HTMLImageElement)) return false
  // Handle images before Muya's reading-mode menu and Electron's native text menu.
  event.preventDefault()
  event.stopPropagation()
  const items: ContextMenuItem[] = createImageCopyActions(event.target, documentPath, translate, onError)
  popupContextMenu(items, { x: event.clientX, y: event.clientY })
  return true
}
