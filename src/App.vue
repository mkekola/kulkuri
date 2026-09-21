<script setup lang="ts">
import PulseMap from './components/PulseMap.vue';
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>Helsinki Pulse</h1>
      <p>HSL:n joukkoliikenne reaaliajassa, kartalla.</p>
    </header>
    <PulseMap />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
}

.app-header {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 10;
  padding: 14px 20px;
  border-radius: 16px;
  background: rgba(17, 19, 26, 0.72);
  backdrop-filter: blur(10px);
  color: #f5f5f7;
  pointer-events: none;
}

.app-header h1 {
  margin: 0 0 4px;
  font-size: 1.25rem;
  font-weight: 700;
}

.app-header p {
  margin: 0;
  font-size: 0.85rem;
  color: #b8bac2;
}
</style>
