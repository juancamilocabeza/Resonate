const ITEM_HEIGHT = 64
const BUFFER_SIZE = 5

export class VirtualSearchResults {
  constructor (container, items = [], renderItem) {
    if (!container || !container.ownerDocument) {
      throw new TypeError('A DOM container is required')
    }
    if (typeof renderItem !== 'function') {
      throw new TypeError('renderItem must be a function')
    }

    this.container = container
    this.document = container.ownerDocument
    this.items = Array.isArray(items) ? items : []
    this.renderItem = renderItem
    this.startIndex = -1
    this.endIndex = -1
    this.frameId = null

    this.spacer = this.document.createElement('div')
    this.spacer.style.position = 'relative'
    this.spacer.style.width = '100%'

    this.layer = this.document.createElement('div')
    this.layer.style.position = 'absolute'
    this.layer.style.top = '0'
    this.layer.style.left = '0'
    this.layer.style.width = '100%'

    this.spacer.appendChild(this.layer)
    this.container.replaceChildren(this.spacer)
    this.container.style.overflowY = 'auto'

    this.onScroll = () => this.scheduleRender()
    this.container.addEventListener('scroll', this.onScroll, { passive: true })

    const view = this.document.defaultView
    this.requestFrame = view.requestAnimationFrame.bind(view)
    this.cancelFrame = view.cancelAnimationFrame.bind(view)
    this.onResize = () => this.scheduleRender()
    view.addEventListener('resize', this.onResize)

    if (typeof view.ResizeObserver === 'function') {
      this.resizeObserver = new view.ResizeObserver(this.onResize)
      this.resizeObserver.observe(this.container)
    }

    this.render()
  }

  setItems (items) {
    this.items = Array.isArray(items) ? items : []
    this.container.scrollTop = 0
    this.startIndex = -1
    this.endIndex = -1
    this.spacer.style.height = `${this.items.length * ITEM_HEIGHT}px`
    this.scheduleRender()
  }

  scheduleRender () {
    if (this.frameId !== null) return
    this.frameId = this.requestFrame(() => {
      this.frameId = null
      this.render()
    })
  }

  render () {
    const total = this.items.length
    const visibleCount = Math.ceil(this.container.clientHeight / ITEM_HEIGHT)
    const firstVisible = Math.floor(this.container.scrollTop / ITEM_HEIGHT)
    const startIndex = Math.max(0, firstVisible - BUFFER_SIZE)
    const endIndex = Math.min(total, firstVisible + visibleCount + BUFFER_SIZE)

    this.spacer.style.height = `${total * ITEM_HEIGHT}px`
    if (startIndex === this.startIndex && endIndex === this.endIndex) return

    const fragment = this.document.createDocumentFragment()
    for (let index = startIndex; index < endIndex; index++) {
      const row = this.document.createElement('div')
      row.style.height = `${ITEM_HEIGHT}px`
      row.style.boxSizing = 'border-box'

      const content = this.renderItem(this.items[index], index)
      if (content && typeof content === 'object' && typeof content.nodeType === 'number') {
        row.appendChild(content)
      } else if (typeof content === 'string') {
        row.innerHTML = content
      } else if (content !== null && content !== undefined) {
        row.textContent = String(content)
      }

      fragment.appendChild(row)
    }

    this.layer.replaceChildren(fragment)
    this.layer.style.transform = `translateY(${startIndex * ITEM_HEIGHT}px)`
    this.startIndex = startIndex
    this.endIndex = endIndex
  }

  unload () {
    this.container.removeEventListener('scroll', this.onScroll)
    this.document.defaultView.removeEventListener('resize', this.onResize)

    if (this.resizeObserver) this.resizeObserver.disconnect()
    if (this.frameId !== null) {
      this.cancelFrame(this.frameId)
      this.frameId = null
    }

    if (this.spacer.parentNode === this.container) {
      this.container.removeChild(this.spacer)
    }
  }
}

export default VirtualSearchResults
