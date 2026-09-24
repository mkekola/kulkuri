<script setup lang="ts">
// Shared by VehicleDetail's (route-scoped) and StopDetail's (stop-scoped)
// service alerts - same look either way, only what's fed in differs.
defineProps<{ headerText: string }>();
</script>

<template>
  <div class="alert-banner">
    <svg
      class="alert-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
    <span class="alert-text">{{ headerText }}</span>
  </div>
</template>

<style scoped>
.alert-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 122, 69, 0.12);
  border: 1px solid rgba(255, 122, 69, 0.35);
  color: var(--accent-text);
  font-size: 12px;
  line-height: 1.4;
}

.alert-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 1px;
}

.alert-text {
  flex: 1;
  min-width: 0;
}
</style>
