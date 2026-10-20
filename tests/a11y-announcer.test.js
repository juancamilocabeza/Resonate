import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const attributes = {}
const timers = new Map()
let timerId = 0
let region = null
const document = {
  body: {
    appendChild (element) {
      region = element
    }
  },
  getElementById (id) {
    return id === 'a11y-status-announce' ? region : null
  },
  createElement (tagName) {
    return {
      tagName,
      setAttribute (name, value) {
        attributes[name] = value
      },
      textContent: '',
      className: ''
    }
  }
}
const context = {
  document,
  clearTimeout (id) {
    timers.delete(id)
  },
  setTimeout (callback) {
    timerId += 1
    timers.set(timerId, callback)
    return timerId
  }
}
context.window = context
vm.createContext(context)

const source = await readFile(new URL('../js/A11yAnnouncer.js', import.meta.url), 'utf8')
vm.runInContext(source, context)

function runNextTimer () {
  const [id, callback] = Array.from(timers.entries())[0]
  timers.delete(id)
  callback()
}

assert.ok(region)
assert.equal(region.id, 'a11y-status-announce')
assert.equal(region.className, 'sr-only')
assert.equal(attributes['aria-live'], 'polite')
assert.equal(attributes['aria-atomic'], 'true')

assert.equal(context.A11yAnnouncer.announce('Track changed'), true)
assert.equal(region.textContent, '')
runNextTimer()
assert.equal(region.textContent, 'Track changed')

assert.equal(context.A11yAnnouncer.announce('Queue updated', 'assertive'), true)
assert.equal(attributes['aria-live'], 'assertive')
assert.equal(region.textContent, '')
runNextTimer()
assert.equal(region.textContent, 'Queue updated')

context.A11yAnnouncer.announce('Shuffle enabled')
assert.equal(attributes['aria-live'], 'polite')
assert.equal(region.textContent, '')
runNextTimer()
assert.equal(region.textContent, 'Shuffle enabled')

assert.equal(context.A11yAnnouncer.announce('  '), false)

console.log('Accessibility announcer tests passed')
