/**
 * Vue Router configuration
 */

import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/dashboards',
    },
    {
      path: '/dashboards',
      name: 'dashboards',
      component: () => import('../views/DashboardListView.vue'),
      meta: {
        title: 'Dashboards - Pulseboard',
      },
    },
    {
      path: '/dashboards/:id',
      name: 'dashboard-live',
      component: () => import('../views/DashboardLiveView.vue'),
      meta: {
        title: 'Dashboard - Pulseboard',
      },
    },
    {
      path: '/feeds',
      name: 'feeds',
      component: () => import('../views/FeedsView.vue'),
      meta: {
        title: 'Feeds - Pulseboard',
      },
    },
  ],
})

// Update page title
router.afterEach((to) => {
  document.title = (to.meta.title as string) || 'Pulseboard'
})

export default router
