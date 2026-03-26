import { MatDialogConfig } from '@angular/material/dialog';

const MOBILE_DIALOG_MAX_WIDTH = 'calc(100vw - 2rem)';

export function createResponsiveDialogConfig<T>(data: T, width: string): MatDialogConfig<T> {
  return {
    width,
    maxWidth: MOBILE_DIALOG_MAX_WIDTH,
    data
  };
}

export function createResponsiveDialogConfigWithoutData(width: string): MatDialogConfig {
  return {
    width,
    maxWidth: MOBILE_DIALOG_MAX_WIDTH
  };
}
