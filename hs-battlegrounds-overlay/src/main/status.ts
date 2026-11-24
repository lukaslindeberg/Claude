/**
 * AppStatus holder: merges partial updates and notifies (coalesced) on change.
 * No Electron imports.
 */
import type { AppStatus } from '@shared/types';
import { NOT_FOUND } from './hearthstone/windowTracker';

const MAX_ERRORS = 10;

export class StatusStore {
  private status: AppStatus;
  private key: string;
  private scheduled = false;

  constructor(
    init: Pick<AppStatus, 'version' | 'platform' | 'cardData'>,
    private readonly onChange: (status: AppStatus) => void,
  ) {
    this.status = {
      version: init.version,
      platform: init.platform,
      logConfig: 'unknown',
      hearthstoneRunning: false,
      gameWindow: { ...NOT_FOUND },
      watching: false,
      demo: { running: false },
      cardData: init.cardData,
      errors: [],
    };
    this.key = JSON.stringify(this.status);
  }

  get(): AppStatus {
    return this.status;
  }

  update(patch: Partial<AppStatus>): void {
    this.status = { ...this.status, ...patch };
    this.maybeNotify();
  }

  addError(message: string): void {
    const errors = [...this.status.errors.filter((e) => e !== message), message].slice(-MAX_ERRORS);
    this.update({ errors });
  }

  clearError(predicate: (e: string) => boolean): void {
    const errors = this.status.errors.filter((e) => !predicate(e));
    if (errors.length !== this.status.errors.length) this.update({ errors });
  }

  private maybeNotify(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const key = JSON.stringify(this.status);
      if (key === this.key) return;
      this.key = key;
      this.onChange(this.status);
    });
  }
}
