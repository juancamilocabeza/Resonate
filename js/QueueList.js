export function reorderQueue (queue, fromIndex, toIndex) {
  if (!Array.isArray(queue) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
    fromIndex < 0 || fromIndex >= queue.length ||
    toIndex < 0 || toIndex >= queue.length ||
    fromIndex === toIndex) return null

  const [track] = queue.splice(fromIndex, 1)
  queue.splice(toIndex, 0, track)
  return track
}

export class QueueList {
  constructor (list, announcement) {
    this.list = list
    this.announcement = announcement
    this.dragIndex = null
    this.handleClick = this.handleClick.bind(this)
    this.handleDragStart = this.handleDragStart.bind(this)
    this.handleDragOver = this.handleDragOver.bind(this)
    this.handleDrop = this.handleDrop.bind(this)
    this.handleDragEnd = this.handleDragEnd.bind(this)
    list?.addEventListener('click', this.handleClick)
    list?.addEventListener('dragstart', this.handleDragStart)
    list?.addEventListener('dragover', this.handleDragOver)
    list?.addEventListener('drop', this.handleDrop)
    list?.addEventListener('dragend', this.handleDragEnd)
  }

  getQueue () {
    return Array.isArray(window.state?.playbackQueue) ? window.state.playbackQueue : []
  }

  getTrackLabel (track) {
    const title = track && (track.title || track.name) ? (track.title || track.name) : 'Untitled track'
    const artist = track && (track.creator || track.artist) ? (track.creator || track.artist) : 'Unknown artist'
    return { title: String(title), artist: String(artist) }
  }

  render () {
    if (!this.list) return
    const queue = this.getQueue()
    this.list.replaceChildren()

    if (!queue.length) {
      const empty = document.createElement('li')
      empty.className = 'player-queue__empty'
      empty.textContent = 'No upcoming tracks'
      this.list.appendChild(empty)
      return
    }

    queue.forEach((track, index) => {
      const { title, artist } = this.getTrackLabel(track)
      const item = document.createElement('li')
      item.className = 'player-queue__item'
      item.draggable = true
      item.dataset.queueIndex = String(index)
      item.setAttribute('aria-label', `${title} by ${artist}, position ${index + 1}`)

      const position = document.createElement('span')
      position.className = 'player-queue__position'
      position.textContent = String(index + 1).padStart(2, '0')

      const metadata = document.createElement('span')
      metadata.className = 'player-queue__metadata'
      const titleElement = document.createElement('span')
      titleElement.className = 'player-queue__title'
      titleElement.textContent = title
      const artistElement = document.createElement('span')
      artistElement.className = 'player-queue__artist'
      artistElement.textContent = artist
      metadata.append(titleElement, artistElement)

      const actions = document.createElement('span')
      actions.className = 'player-queue__actions'
      actions.append(
        this.createMoveButton('up', index, 'Move track up'),
        this.createMoveButton('down', index, 'Move track down')
      )

      item.append(position, metadata, actions)
      this.list.appendChild(item)
    })
  }

  createMoveButton (direction, index, label) {
    const button = document.createElement('button')
    button.className = 'player-queue__move'
    button.type = 'button'
    button.dataset.queueMove = direction
    button.dataset.queueIndex = String(index)
    button.setAttribute('aria-label', label)
    button.disabled = direction === 'up' ? index === 0 : index === this.getQueue().length - 1
    button.textContent = direction === 'up' ? '↑' : '↓'
    return button
  }

  handleClick (event) {
    const button = event.target.closest('[data-queue-move]')
    if (!button || !this.list.contains(button)) return
    const index = Number(button.dataset.queueIndex)
    const target = button.dataset.queueMove === 'up' ? index - 1 : index + 1
    this.reorder(index, target)
  }

  handleDragStart (event) {
    const item = event.target.closest('[data-queue-index]')
    if (!item || !event.dataTransfer) return
    this.dragIndex = Number(item.dataset.queueIndex)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(this.dragIndex))
    item.classList.add('is-dragging')
  }

  handleDragOver (event) {
    if (this.dragIndex === null) return
    const item = event.target.closest('[data-queue-index]')
    if (!item || !this.list.contains(item)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  handleDrop (event) {
    const item = event.target.closest('[data-queue-index]')
    if (this.dragIndex === null || !item || !this.list.contains(item)) return
    event.preventDefault()
    this.reorder(this.dragIndex, Number(item.dataset.queueIndex))
    this.dragIndex = null
  }

  handleDragEnd (event) {
    event.target.closest('[data-queue-index]')?.classList.remove('is-dragging')
    this.dragIndex = null
  }

  reorder (fromIndex, toIndex) {
    const queue = this.getQueue()
    const track = reorderQueue(queue, fromIndex, toIndex)
    if (!track) return false
    this.render()
    window.dispatchEvent(new CustomEvent('resonate:queue-updated', {
      detail: { count: queue.length, fromIndex, toIndex }
    }))

    const focusTarget = this.list.querySelector(
      `[data-queue-index="${toIndex}"] [data-queue-move]:not(:disabled)`
    )
    focusTarget?.focus()
    if (this.announcement) {
      const { title } = this.getTrackLabel(track)
      this.announcement.textContent = `Moved ${title} to position ${toIndex + 1} of ${queue.length}.`
    }
    return true
  }

  destroy () {
    this.list?.removeEventListener('click', this.handleClick)
    this.list?.removeEventListener('dragstart', this.handleDragStart)
    this.list?.removeEventListener('dragover', this.handleDragOver)
    this.list?.removeEventListener('drop', this.handleDrop)
    this.list?.removeEventListener('dragend', this.handleDragEnd)
  }
}

if (typeof window !== 'undefined') window.QueueList = QueueList
