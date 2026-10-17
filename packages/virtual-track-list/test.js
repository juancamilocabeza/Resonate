const assert = require('node:assert/strict')
const VirtualTrackList = require('./index')

assert.deepEqual(
  VirtualTrackList.getVisibleRange(100, 20, 100, 200),
  { startIndex: 7, endIndex: 18 }
)
assert.deepEqual(
  VirtualTrackList.getVisibleRange(5, 20, 100, 0),
  { startIndex: 0, endIndex: 5 }
)
assert.deepEqual(
  VirtualTrackList.getVisibleRange(0, 20, 100, 0),
  { startIndex: 0, endIndex: 0 }
)

const events = []
const component = new VirtualTrackList({
  events: {
    emit (name, payload) {
      events.push({ name, payload })
    }
  }
})
let componentRenders = 0
component.rerender = () => { componentRenders += 1 }
const props = {
  items: [{ title: 'Track' }],
  rowHeight: 20,
  viewportHeight: 100,
  scrollTop: 0
}

assert.equal(component.update(props), true)
assert.equal(component.update(props), false)
assert.equal(component.update({ ...props, scrollTop: 20 }), true)
component.selectTrack(props.items[0], 0)
component.onScroll({ currentTarget: { scrollTop: 40 } })
assert.deepEqual(events, [
  { name: 'tracklist:select', payload: { track: props.items[0], index: 0 } },
  { name: 'tracklist:scroll', payload: { scrollTop: 40 } }
])
assert.equal(componentRenders, 1)

assert.throws(
  () => component.update({ ...props, rowHeight: 0 }),
  /rowHeight must be a positive finite number/
)

console.log('Virtual track list tests passed')
