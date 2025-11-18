/**
 * Vue Router configuration
 */

import { createRouter, createWebHistory } from 'vue-router'
import DashboardListView from '../views/DashboardListView.vue'
import DashboardLiveView from '../views/DashboardLiveView.vue'

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
      component: DashboardListView,
      meta: {
        title: 'Dashboards - Pulseboard',
      },
    },
    {
      path: '/dashboards/:id',
      name: 'dashboard-live',
      component: DashboardLiveView,
      meta: {
        title: 'Dashboard - Pulseboard',
      },
    },
  ],
})

// Update page title
router.afterEach((to) => {
  document.title = (to.meta.title as string) || 'Pulseboard'
})

export default router
