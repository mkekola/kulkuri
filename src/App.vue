<script setup lang="ts">
import { ref } from 'vue';
import PulseMap from './components/PulseMap.vue';
import AppSidebar from './components/AppSidebar.vue';
import { useVehiclePositions } from './composables/useVehiclePositions';

const { vehicles } = useVehiclePositions();
const activeMode = ref('all');
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :vehicles="vehicles"
      :active-mode="activeMode"
      @update:active-mode="activeMode = $event"
    />
    <div class="map-area">
      <PulseMap :vehicles="vehicles" :active-mode="activeMode" />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: #0a0f1c;
}

.map-area {
  position: relative;
  flex: 1;
  padding: 14px;
}
</style>
