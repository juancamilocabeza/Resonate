export class AudioNodeLifecycleManager {
  constructor () {
    this.nodes = new Set()
  }

  createSource (buffer, targetDestination) {
    if (!targetDestination || !targetDestination.context) {
      throw new TypeError('A destination connected to an AudioContext is required')
    }

    const context = targetDestination.context
    const sourceNode = context.createBufferSource()
    const gainNode = context.createGain()
    const node = {
      sourceNode,
      gainNode,
      active: false
    }

    sourceNode.buffer = buffer
    sourceNode.connect(gainNode)
    gainNode.connect(targetDestination)
    sourceNode.onended = () => {
      node.active = false
      this.disposeNode(sourceNode, gainNode)
    }
    this.nodes.add(node)

    try {
      sourceNode.start()
      node.active = true
    } catch (error) {
      this.disposeNode(sourceNode, gainNode)
      throw error
    }

    return { sourceNode, gainNode }
  }

  disposeNode (sourceNode, gainNode) {
    const node = Array.from(this.nodes).find(node => node.sourceNode === sourceNode)

    if (sourceNode) {
      const shouldStop = !node || node.active
      if (node) node.active = false

      if (shouldStop) {
        try {
          sourceNode.stop()
        } catch (error) {
          if (error.name !== 'InvalidStateError') throw error
        }
      }

      sourceNode.onended = null
      sourceNode.disconnect()
      sourceNode.buffer = null
    }

    if (gainNode) gainNode.disconnect()

    if (node) {
      node.sourceNode = null
      node.gainNode = null
      node.active = false
      this.nodes.delete(node)
    }
  }

  cleanupAll () {
    for (const node of Array.from(this.nodes)) {
      this.disposeNode(node.sourceNode, node.gainNode)
    }
  }
}

const audioNodeLifecycleManager = new AudioNodeLifecycleManager()

export { audioNodeLifecycleManager }
export default audioNodeLifecycleManager
