export class AudioNodeLifecycle {
  constructor (options = {}) {
    this.document = options.document !== undefined
      ? options.document
      : (typeof globalThis.document !== 'undefined' ? globalThis.document : null)
    this.onError = options.onError || (error => console.error('Audio context recovery failed', error))
    this.nodes = new Set()
    this.contexts = new Set()
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
    this.document?.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  register (sourceNode, gainNode, onended) {
    if (!sourceNode || !gainNode) throw new TypeError('Source and gain nodes are required')

    const node = { sourceNode, gainNode, active: true }
    const context = sourceNode.context
    if (context) this.contexts.add(context)
    this.nodes.add(node)
    sourceNode.onended = event => {
      this.disposeNode(sourceNode, gainNode, { stop: false })
      if (typeof onended === 'function') onended(event)
    }
    return node
  }

  createSource (buffer, destination, options = {}) {
    if (!destination || !destination.context) {
      throw new TypeError('A destination connected to an AudioContext is required')
    }

    const context = destination.context
    const sourceNode = context.createBufferSource()
    const gainNode = context.createGain()
    try {
      sourceNode.buffer = buffer
      gainNode.gain.setValueAtTime(options.gain ?? 1, options.startTime ?? context.currentTime)
      sourceNode.connect(gainNode)
      gainNode.connect(destination)
      this.register(sourceNode, gainNode, options.onended)

      if (options.start !== false) {
        sourceNode.start(options.startTime ?? context.currentTime, options.offset ?? 0)
      }
    } catch (error) {
      this.disposeNode(sourceNode, gainNode)
      throw error
    }

    return { sourceNode, gainNode }
  }

  disposeNode (sourceNode, gainNode, options = {}) {
    const node = Array.from(this.nodes).find(item => item.sourceNode === sourceNode)
    const shouldStop = options.stop !== false && (!node || node.active)

    if (node) node.active = false
    if (sourceNode) {
      sourceNode.onended = null
      if (shouldStop) {
        try {
          sourceNode.stop()
        } catch (error) {
          if (error.name !== 'InvalidStateError') throw error
        }
      }
      sourceNode.disconnect()
      sourceNode.buffer = null
    }
    if (gainNode) gainNode.disconnect()

    if (node) {
      node.sourceNode = null
      node.gainNode = null
      this.nodes.delete(node)
    }
    this.pruneContexts()
  }

  pruneContexts () {
    const activeContexts = new Set(
      Array.from(this.nodes, node => node.sourceNode && node.sourceNode.context).filter(Boolean)
    )
    this.contexts = activeContexts
  }

  handleVisibilityChange () {
    if (!this.document || this.document.visibilityState === 'visible') return

    for (const context of this.contexts) {
      if (context.state !== 'suspended' || typeof context.resume !== 'function') continue
      const reportError = error => {
        try {
          this.onError(error)
        } catch (callbackError) {
          console.error('Audio context recovery error handler failed', callbackError)
        }
      }
      try {
        Promise.resolve(context.resume()).catch(reportError)
      } catch (error) {
        reportError(error)
      }
    }
  }

  cleanupAll () {
    for (const node of Array.from(this.nodes)) {
      this.disposeNode(node.sourceNode, node.gainNode)
    }
  }

  destroy () {
    this.cleanupAll()
    this.document?.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.contexts.clear()
  }
}

export default AudioNodeLifecycle
