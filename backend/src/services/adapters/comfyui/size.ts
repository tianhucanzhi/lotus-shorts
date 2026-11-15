/** ComfyUI / SDXL 尺寸解析：对齐莲花常用像素与本地显存上限 */

type ResKey = '1K' | '2K' | '4K'

const RATIO_TABLE: Record<string, Record<ResKey, [number, number]>> = {
  '1:1': { '1K': [1024, 1024], '2K': [2048, 2048], '4K': [2880, 2880] },
  '3:2': { '1K': [1536, 1024], '2K': [2048, 1360], '4K': [3520, 2336] },
  '2:3': { '1K': [1024, 1536], '2K': [1360, 2048], '4K': [2336, 3520] },
  '4:3': { '1K': [1024, 768], '2K': [2048, 1536], '4K': [3312, 2480] },
  '3:4': { '1K': [768, 1024], '2K': [1536, 2048], '4K': [2480, 3312] },
  '16:9': { '1K': [1536, 864], '2K': [2048, 1152], '4K': [3840, 2160] },
  '9:16': { '1K': [864, 1536], '2K': [1152, 2048], '4K': [2160, 3840] },
}

const PIXEL_RE = /^(\d{2,4})x(\d{2,4})$/i

function align16(n: number): number {
  return Math.max(16, Math.round(n / 16) * 16)
}

export function resolveSize(
  size?: string | null,
  resolution: string = '1K',
): { width: number; height: number } {
  const res = (['1K', '2K', '4K'].includes(String(resolution).toUpperCase())
    ? String(resolution).toUpperCase()
    : '1K') as ResKey

  if (!size || size === 'auto') {
    return { width: RATIO_TABLE['1:1'][res][0], height: RATIO_TABLE['1:1'][res][1] }
  }

  const pixel = size.match(PIXEL_RE)
  if (pixel) {
    // 莲花常发 1920x1080；1080 非 16 倍数，自动对齐
    const width = align16(Number(pixel[1]))
    const height = align16(Number(pixel[2]))
    validateExactPixels(width, height)
    return { width, height }
  }

  const ratio = RATIO_TABLE[size]
  if (!ratio) {
    throw new Error(`不支持的 size: ${size}`)
  }
  const [width, height] = ratio[res]
  return { width, height }
}

function validateExactPixels(width: number, height: number) {
  if (width > 3840 || height > 3840) {
    throw new Error('单边不能超过 3840')
  }
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long / short > 3) {
    throw new Error('长短边比不能超过 3:1')
  }
  const pixels = width * height
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error('总像素须在 655360～8294400')
  }
}

export function qualityToSteps(quality?: string | null): number {
  switch ((quality || 'high').toLowerCase()) {
    case 'low':
      return 12
    case 'medium':
      return 18
    case 'high':
    case 'auto':
      return 25
    case 'xhigh':
      return 30
    case 'max':
      return 35
    default:
      return 25
  }
}

export function clampForSdxl(width: number, height: number): { width: number; height: number } {
  const maxSide = 2048
  const long = Math.max(width, height)
  if (long <= maxSide) {
    return { width: align16(width), height: align16(height) }
  }
  const scale = maxSide / long
  return {
    width: align16(width * scale),
    height: align16(height * scale),
  }
}
