// Sandbox smoke test for the Client half: no browser, no real Cordis.
// It emulates the DSH module loader contract and a minimal slots service, then
// asserts the plugin registers a settings.section page without touching the DOM
// beyond what ensureCss() needs (which we stub).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Minimal React stand-in: enough for the module factory to capture createElement. */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  Fragment: 'fragment',
}

function loadPlugin() {
  let loaded = null
  const styles = []
  const fakeDocument = {
    head: {
      append(node) {
        styles.push(node)
      },
      appendChild(node) {
        styles.push(node)
      },
    },
    querySelector(selector) {
      return styles.find((node) => node.getAttribute?.('data-plugin-css') === selector.replace(/^style\[data-plugin-css="|"\]$/g, '')) ?? null
    },
    createElement(tag) {
      const attributes = new Map()
      return {
        tagName: tag,
        textContent: '',
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name),
      }
    },
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition
      },
    },
    document: fakeDocument,
    navigator: { language: 'zh-CN' },
    addEventListener() {},
    setTimeout,
  }
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = fakeWindow
  globalThis.document = fakeDocument
  try {
    // The module body is an expression statement that registers with the loader.
    new Function('window', 'document', 'navigator', SOURCE)(fakeWindow, fakeDocument, fakeWindow.navigator)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
  assert.ok(loaded, 'client.js must call window.__ModuleLoader__.load')
  return { loaded, styles }
}

test('client half registers a settings.section page', () => {
  const { loaded } = loadPlugin()
  assert.equal(loaded.id, 'dsh-workspace-cleaner')
  const module = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return fakeReact
  })
  assert.equal(module.name, 'workspace-cleaner')
  assert.deepEqual(module.inject, ['slots'])
  assert.equal(typeof module.apply, 'function')

  const registered = []
  const injected = []
  module.apply({
    slots: {
      inject(key, callback) {
        injected.push(key)
        callback()
      },
      register(entry, component) {
        registered.push({ entry, component })
        return () => {}
      },
    },
  })
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].entry.name, 'settings.section')
  assert.equal(registered[0].entry.id, 'workspace-cleaner')
  assert.equal(registered[0].entry.order, 45)
  assert.equal(typeof registered[0].entry.label, 'function')
  assert.equal(typeof registered[0].entry.label(), 'string')
  assert.equal(typeof registered[0].component, 'function')
})

test('page component renders a tree for a small inventory', async () => {
  const { loaded } = loadPlugin()
  const module = loaded.factory(() => fakeReact)
  let page = null
  module.apply({
    slots: {
      inject: (key, callback) => callback(),
      register: (entry, component) => {
        page = component
        return () => {}
      },
    },
  })
  // Component is invoked with owner props; useState/useEffect are stubbed, so the
  // first render must not throw and must reference the slot's injected props.
  const tree = page({})
  assert.ok(tree, 'page must return an element tree')
})
