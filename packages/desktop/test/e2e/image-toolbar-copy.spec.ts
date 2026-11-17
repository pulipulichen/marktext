import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expectNoRendererErrors, launchElectron, waitForEditor } from './helpers'
import { backupClipboard, readClipboardState, restoreClipboard } from './clipboardHelpers'

test.describe('image toolbar clipboard actions', () => {
  let app: ElectronApplication
  let page: Page
  let fixture: string
  let imagePath: string

  test.beforeAll(async() => {
    fixture = mkdtempSync(join(tmpdir(), 'marktext-image-toolbar-'))
    mkdirSync(join(fixture, 'assets'))
    imagePath = join(fixture, 'assets/圖 a.png')
    copyFileSync(resolve('static/logo-96px.png'), imagePath)
    const documentPath = join(fixture, 'note.md')
    writeFileSync(documentPath, '![sample](./assets/圖%20a.png)\n')
    const launched = await launchElectron([documentPath], {
      suppressErrorDialog: true,
      preferences: { language: 'en', autoSave: false }
    })
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await backupClipboard(app)
    await expect(page.locator('.editor-component .mu-image-success img')).toHaveCount(1)
  })

  test.beforeEach(async() => {
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await page.locator('.editor-component .mu-image-success img').click()
    await expect(page.getByRole('button', { name: 'Copy Image', exact: true })).toBeVisible()
  })

  test.afterEach(async() => {
    await expectNoRendererErrors(app)
  })

  test.afterAll(async() => {
    if (app) {
      await restoreClipboard(app)
      await app.close()
    }
    if (fixture) rmSync(fixture, { recursive: true, force: true })
  })

  test('writes real PNG data to the system clipboard', async() => {
    await page.getByRole('button', { name: 'Copy Image', exact: true }).click()
    await expect.poll(async() => (await readClipboardState(app)).formats).toContain('image/png')
    expect((await readClipboardState(app)).size).toEqual({ width: 96, height: 96 })
  })

  test('copies relative and absolute paths without losing image selection', async() => {
    await page.getByRole('button', { name: 'Copy Relative Image Path', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('./assets/圖 a.png')
    await page.getByRole('button', { name: 'Copy Absolute Image Path', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(imagePath)
  })
})
