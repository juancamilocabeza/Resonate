const FALLBACK_COLORS = {
  primary: '#263943',
  secondary: '#34434B'
}

const colorCache = new Map()

function linearChannel (channel) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance (color) {
  return 0.2126 * linearChannel(color.r) +
    0.7152 * linearChannel(color.g) +
    0.0722 * linearChannel(color.b)
}

function toHex (color) {
  return `#${[color.r, color.g, color.b]
    .map(channel => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function clampForLightText (color) {
  const luminance = relativeLuminance(color)
  const maxLuminance = 0.085
  if (luminance <= maxLuminance) return color

  const scale = Math.sqrt(maxLuminance / luminance)
  return {
    r: color.r * scale,
    g: color.g * scale,
    b: color.b * scale
  }
}

function contrastRatio (foreground, background) {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function colorFromBucket (bucket) {
  return clampForLightText({
    r: bucket.r / bucket.count,
    g: bucket.g / bucket.count,
    b: bucket.b / bucket.count
  })
}

function samplePixels (pixels) {
  const buckets = new Map()
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 220) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.count++
    buckets.set(key, bucket)
  }

  const ranked = Array.from(buckets.values()).sort((first, second) => second.count - first.count)
  if (!ranked.length) throw new Error('Artwork contains no opaque pixels to sample')

  const primary = colorFromBucket(ranked[0])
  const secondary = colorFromBucket(ranked.find(bucket => {
    const color = colorFromBucket(bucket)
    return contrastRatio({ r: 255, g: 255, b: 255 }, color) > 4.5 &&
      Math.hypot(color.r - primary.r, color.g - primary.g, color.b - primary.b) > 24
  }) || ranked[1] || ranked[0])

  return { primary: toHex(primary), secondary: toHex(secondary) }
}

function sampleImage (image) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D context is unavailable')

  canvas.width = 32
  canvas.height = 32
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return samplePixels(context.getImageData(0, 0, canvas.width, canvas.height).data)
}

function loadImage (url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    try {
      const parsedUrl = new URL(url, window.location.href)
      if (parsedUrl.origin !== window.location.origin &&
        (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')) {
        image.crossOrigin = 'anonymous'
      }
    } catch (error) {
      reject(error)
      return
    }

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Artwork is unavailable for color extraction'))
    image.src = url
    if (image.complete && image.naturalWidth > 0) resolve(image)
  })
}

export class ColorExtractor {
  static async extract (url) {
    if (!url) return { ...FALLBACK_COLORS }
    if (colorCache.has(url)) return { ...colorCache.get(url) }

    const image = await loadImage(url)
    const colors = sampleImage(image)
    if (colorCache.size >= 100) {
      colorCache.delete(colorCache.keys().next().value)
    }
    colorCache.set(url, colors)
    return { ...colors }
  }

  static getFallbackColors () {
    return { ...FALLBACK_COLORS }
  }

  static contrastRatio (foreground, background) {
    return contrastRatio(foreground, background)
  }

  static relativeLuminance (color) {
    return relativeLuminance(color)
  }

  static extractFromPixels (pixels) {
    return samplePixels(pixels)
  }
}

if (typeof window !== 'undefined') window.ColorExtractor = ColorExtractor
