const Nanocomponent = require('nanocomponent')
const html = require('nanohtml')

const BUFFER_SIZE = 3
const SELECT_EVENT = 'tracklist:select'
const SCROLL_EVENT = 'tracklist:scroll'

function getVisibleRange (itemCount, rowHeight, viewportHeight, scrollTop) {
  const firstVisibleIndex = Math.floor(scrollTop / rowHeight)
  const startIndex = Math.max(0, firstVisibleIndex - BUFFER_SIZE)
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + BUFFER_SIZE
  )

  return { startIndex, endIndex }
}

function validateProps (props) {
  if (!props || !Array.isArray(props.items)) {
    throw new TypeError('VirtualTrackList props.items must be an array')
  }
  if (!Number.isFinite(props.rowHeight) || props.rowHeight <= 0) {
    throw new RangeError('VirtualTrackList props.rowHeight must be a positive finite number')
  }
  if (!Number.isFinite(props.viewportHeight) || props.viewportHeight < 0) {
    throw new RangeError('VirtualTrackList props.viewportHeight must be a non-negative finite number')
  }
  if (!Number.isFinite(props.scrollTop) || props.scrollTop < 0) {
    throw new RangeError('VirtualTrackList props.scrollTop must be a non-negative finite number')
  }
}

function trackTitle (track) {
  return String(track.title || track.name || 'Untitled track')
}

function trackArtist (track) {
  return String(track.artist || track.creator || '')
}

class VirtualTrackList extends Nanocomponent {
  constructor (state) {
    super()
    this.state = state
    this.lastProps = null
    this.scrollTop = null
  }

  createElement (props) {
    validateProps(props)
    this.lastProps = props
    if (this.scrollTop === null) this.scrollTop = props.scrollTop

    const { startIndex, endIndex } = getVisibleRange(
      props.items.length,
      props.rowHeight,
      props.viewportHeight,
      this.scrollTop
    )
    const rows = []

    for (let index = startIndex; index < endIndex; index++) {
      const track = props.items[index]
      rows.push(html`
        <button
          class="virtual-track-list__row"
          type="button"
          role="option"
          aria-posinset="${index + 1}"
          aria-setsize="${props.items.length}"
          style="height:${props.rowHeight}px;left:0;position:absolute;right:0;top:0;transform:translateY(${index * props.rowHeight}px)"
          onclick=${event => {
            event.stopPropagation()
            this.selectTrack(track, index)
          }}
        >
          <span class="virtual-track-list__title">${trackTitle(track)}</span>
          <span class="virtual-track-list__artist">${trackArtist(track)}</span>
        </button>
      `)
    }

    const list = html`
      <div
        class="virtual-track-list"
        role="listbox"
        style="height:${props.viewportHeight}px;overflow-y:auto;position:relative"
        onscroll=${event => this.onScroll(event)}
      >
        <div
          class="virtual-track-list__spacer"
          style="height:${props.items.length * props.rowHeight}px;position:relative"
        >
          ${rows}
        </div>
      </div>
    `

    list.scrollTop = this.scrollTop
    return list
  }

  update (props) {
    validateProps(props)
    const previous = this.lastProps
    const changed = !previous ||
      previous.items !== props.items ||
      previous.rowHeight !== props.rowHeight ||
      previous.viewportHeight !== props.viewportHeight ||
      previous.scrollTop !== props.scrollTop

    if (!previous || previous.scrollTop !== props.scrollTop) {
      this.scrollTop = props.scrollTop
    }
    this.lastProps = props
    return changed
  }

  afterupdate (element) {
    if (element.scrollTop !== this.lastProps.scrollTop) {
      element.scrollTop = this.lastProps.scrollTop
    }
  }

  selectTrack (track, index) {
    if (this.state && this.state.events && typeof this.state.events.emit === 'function') {
      this.state.events.emit(SELECT_EVENT, { track, index })
    }
  }

  onScroll (event) {
    const scrollTop = event.currentTarget.scrollTop
    if (scrollTop === this.scrollTop) return
    this.scrollTop = scrollTop
    if (this.state && this.state.events && typeof this.state.events.emit === 'function') {
      this.state.events.emit(SCROLL_EVENT, { scrollTop: this.scrollTop })
    }
    this.rerender()
  }
}

VirtualTrackList.getVisibleRange = getVisibleRange
VirtualTrackList.events = { select: SELECT_EVENT, scroll: SCROLL_EVENT }

module.exports = VirtualTrackList
