# VirtualTrackList

`VirtualTrackList` is a Nanocomponent for Choo apps. It renders only the visible
track rows with three buffered rows on each side. The outer viewport scrolls
natively, while each row is positioned with `translateY` in a spacer whose
height represents the full list.

```js
const VirtualTrackList = require('@resonate/virtual-track-list')

const trackList = new VirtualTrackList(state)

function view (state) {
  return html`
    <main>
      ${trackList.render({
        items: state.tracks,
        rowHeight: 56,
        viewportHeight: 420,
        scrollTop: state.trackListScrollTop
      })}
    </main>
  `
}
```

The component emits `tracklist:select` with `{ track, index }` when a row is
clicked, and `tracklist:scroll` with `{ scrollTop }` when its viewport scrolls.
These are ordinary Choo state events; the component does not emit a `render`
event when a row is selected. Scrolling rerenders only this component, not the
outer page. Applications can synchronize `trackListScrollTop` from
`tracklist:scroll`; passing a changed `scrollTop` prop also supports externally
controlled scroll positioning.

```js
state.events.on('tracklist:select', ({ track, index }) => {
  state.selectedTrack = track
  state.selectedTrackIndex = index
})
```

`items` must be an array, `rowHeight` must be positive, and the viewport height
and scroll offset must be non-negative finite numbers.
