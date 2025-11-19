<template>
  <div class="app-container">
    <router-view />
  </div>
</template>

<script setup lang="ts">
// Main app component - simply renders the router view
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  background-attachment: fixed;
}
</style>
