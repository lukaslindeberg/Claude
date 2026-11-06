import { boot } from '../boot';

void boot('settings', {
  settings: () => import('./CompanionApp'),
  overlay: () => import('../overlay/OverlayApp'),
});
