<template>
  <div class="app-container">
    <router-view />
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import ToastContainer from './components/ToastContainer.vue'
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background-color: #0f172a;
}
</style>
