/** Measured package boundaries used by the production Rollup build and unit tests. */
export function workbenchChunk(id: string): string | undefined {
  const moduleId = id.replaceAll('\\', '/')
  if (moduleId.includes('/node_modules/echarts/')) return 'charts-echarts'
  if (moduleId.includes('/node_modules/zrender/')) return 'charts-renderer'
  return undefined
}
