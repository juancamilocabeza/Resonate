import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8')
const computeInsetsSource = source.match(/function computeOverlayInsets\([\s\S]*?\n}\n/)
const applyInsetsSource = source.match(/function applyOverlayInsetVars\([\s\S]*?\n}\n/)
const setSearchInsetsSource = source.match(/function setSearchPanelInsets\([\s\S]*?\n}\n/)
assert.ok(computeInsetsSource, 'computeOverlayInsets should exist in ui.js')
assert.ok(applyInsetsSource, 'applyOverlayInsetVars should exist in ui.js')
assert.ok(setSearchInsetsSource, 'setSearchPanelInsets should exist in ui.js')

const input = {
  getBoundingClientRect: () => ({ bottom: 200 })
}
const viewport = {
  vpTop: 0,
  vpHeight: 800,
  layoutHeight: 800,
  bottomInset: 0
}

const context = {
  elements: {
    searchResults: { classList: { contains: () => true } },
    searchInput: input
  },
  document: {
    documentElement: {
      style: {
        setProperty(name, value) { this[name] = value }
      }
    },
    querySelector: () => null
  },
  getViewportMetrics: () => viewport
}
vm.createContext(context)
vm.runInContext(
  `${computeInsetsSource[0]}\n${applyInsetsSource[0]}\n${setSearchInsetsSource[0]}\nthis.setSearchPanelInsets = setSearchPanelInsets`,
  context
)

context.setSearchPanelInsets()
assert.equal(context.document.documentElement.style['--search-panel-top'], '210px')
assert.equal(context.document.documentElement.style['--search-panel-bottom'], '10px')

const withoutFooter = context.computeOverlayInsets({
  inputEl: input,
  metrics: viewport,
  gapPx: 10
})
assert.ok(800 - withoutFooter.topPx - withoutFooter.bottomPx > 500)

const footer = {
  classList: { contains: name => name === 'footer' },
  offsetHeight: 40,
  getBoundingClientRect: () => ({ top: 740, height: 40 })
}
const withFooter = context.computeOverlayInsets({
  inputEl: input,
  anchorEl: footer,
  metrics: viewport,
  gapPx: 10
})
assert.equal(withFooter.bottomPx, 70)

console.log('Search panel layout tests passed')
