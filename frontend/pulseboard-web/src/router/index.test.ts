import { describe, expect, it } from 'vitest'
import router from './index'

const routedViews = ['dashboards', 'dashboard-live', 'feeds'] as const

describe('workbench route loading', () => {
  it.each(routedViews)('loads the %s view through an async boundary', async (name) => {
    const route = router.getRoutes().find((candidate) => candidate.name === name)
    const loader = route?.components?.default

    expect(route).toBeDefined()
    expect(typeof loader).toBe('function')

    const loaded = await (loader as () => Promise<{ default: unknown }>)()
    expect(loaded.default).toBeDefined()
  })
})
