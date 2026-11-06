import { boot } from '../boot';

void boot('overlay', {
  overlay: () => import('./OverlayApp'),
  settings: () => import('../companion/CompanionApp'),
});
