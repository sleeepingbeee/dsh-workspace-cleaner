/**
 * Package self-check: everything the DSH loader touches must parse without a BOM.
 *
 * A UTF-8 BOM in package.json makes `JSON.parse` fail with
 * "Unexpected token '\ufeff'" and the bundle shows up as 包不可用, so this test
 * guards the packaging contract instead of the plugin logic.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))

function readUtf8(relative) {
  const buffer = readFileSync(join(root, relative))
  return {
    bom: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    text: buffer.toString('utf8'),
  }
}

test('package.json parses and has no BOM', () => {
  const file = readUtf8('package.json')
  assert.equal(file.bom, false, 'package.json must not start with a UTF-8 BOM')
  const manifest = JSON.parse(file.text)
  assert.equal(manifest.name, 'dsh-workspace-cleaner')
  assert.equal(typeof manifest.version, 'string')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots'])
  assert.equal(manifest.dsh.client.platform, 'web')
})

test('every exported entry exists and no runtime file carries a BOM', () => {
  const manifest = JSON.parse(readUtf8('package.json').text)
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (key.includes('*')) continue
    assert.equal(existsSync(join(root, target)), true, `missing export target for ${key}: ${target}`)
  }
  for (const relative of [
    'lib/index.js',
    'lib/store.js',
    'lib/client.js',
    'cordis.patch.yml',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
  ]) {
    assert.equal(readUtf8(relative).bom, false, `${relative} must not start with a UTF-8 BOM`)
  }
})

test('locale dictionaries are valid JSON with meta.title/description', () => {
  for (const language of ['en', 'zh']) {
    const dict = JSON.parse(readUtf8(`locale/${language}.json`).text)
    assert.equal(typeof dict.meta.title, 'string')
    assert.equal(typeof dict.meta.description, 'string')
  }
})

test('cordis.patch.yml inserts the bundle under its package name', () => {
  const { text } = readUtf8('cordis.patch.yml')
  assert.match(text, /insert:/u)
  assert.match(text, /id: workspace-cleaner/u)
  assert.match(text, /name: 'dsh-workspace-cleaner'/u)
})

test('package is publishable: no private flag, MIT license, npm whitelist, repo docs', () => {
  const manifest = JSON.parse(readUtf8('package.json').text)
  assert.equal(manifest.private, undefined, 'a publishable package must not set "private"')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.icon, './icon.svg')
  assert.equal(manifest.files.includes('cordis.patch.yml'), true, 'npm tarball must contain the bundle patch')
  assert.equal(manifest.files.includes('locale'), true, 'npm tarball must contain the locale metadata')
  assert.equal(manifest.files.includes('lib'), true, 'npm tarball must contain both plugin halves')
  for (const relative of ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', '.gitignore', '.gitattributes']) {
    assert.equal(existsSync(join(root, relative)), true, `missing repository file: ${relative}`)
  }
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    assert.equal(existsSync(join(root, workflow)), true, `missing action workflow: ${workflow}`)
  }
})
