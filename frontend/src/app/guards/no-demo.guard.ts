import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DemoModeService } from '../services/demo-mode.service';

export const noDemoGuard: CanActivateFn = () => {
  if (!inject(DemoModeService).enabled()) return true;
  return inject(Router).parseUrl('/');
};
