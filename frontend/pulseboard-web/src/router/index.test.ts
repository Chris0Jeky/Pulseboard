import { describe, expect, it } from 'vitest'
import router from './index'

describe('workbench route loading', () => {
  it('keeps every named view behind an async component boundary', () => {
    const namedRoutes = router.getRoutes().filter((route) => route.name)

    expect(namedRoutes.map((route) => route.name).sort()).toEqual([
      'dashboard-live',
      'dashboards',
      'feeds',
    ])

    for (const route of namedRoutes) {
      expect(
        typeof route.components?.default,
        `${String(route.name)} should load through a route import`,
      ).toBe('function')
    }
  })
})
